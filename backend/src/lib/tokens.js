const prisma = require('./prisma');

// $0.02 per 1K tokens → 50,000 tokens per dollar → 500 tokens per cent
const TOKENS_PER_CENT = 500;
const MIN_AUTO_TOPUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between auto charges

// Deduct tokens from a user's balance after an Anthropic API call.
// Fires auto top-up non-blocking if the balance crossed the threshold.
async function deductTokens(userId, usage) {
  if (!usage) return;
  const total = BigInt((usage.input_tokens || 0) + (usage.output_tokens || 0));
  if (total === 0n) return;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      tokenBalance: { decrement: total },
      tokensUsed: { increment: total }
    },
    select: {
      tokenBalance: true,
      autoTopUpEnabled: true,
      autoTopUpAmountCents: true,
      autoTopUpThresholdCents: true,
      autoTopUpLastTriggeredAt: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true
    }
  });

  // Fire auto top-up if the new balance crossed below the threshold
  if (shouldAutoTopUp(updated)) {
    triggerAutoTopUp(userId, updated).catch(err =>
      console.error('[AutoTopUp] Failed:', err.message)
    );
  }
}

function shouldAutoTopUp(user) {
  if (!user.autoTopUpEnabled) return false;
  if (!user.stripePaymentMethodId || !user.stripeCustomerId) return false;
  if (user.autoTopUpAmountCents < 500) return false; // min $5

  const thresholdTokens = BigInt(user.autoTopUpThresholdCents) * BigInt(TOKENS_PER_CENT);
  if (user.tokenBalance > thresholdTokens) return false;

  // Prevent double-charges: at most once every 5 minutes
  if (user.autoTopUpLastTriggeredAt) {
    const elapsed = Date.now() - new Date(user.autoTopUpLastTriggeredAt).getTime();
    if (elapsed < MIN_AUTO_TOPUP_INTERVAL_MS) return false;
  }

  return true;
}

async function triggerAutoTopUp(userId, user) {
  // Atomically claim the trigger slot — only one concurrent caller can win.
  // Uses a conditional updateMany so the DB serializes the race; 0 rows = another caller won.
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { autoTopUpLastTriggeredAt: null },
        { autoTopUpLastTriggeredAt: { lt: new Date(Date.now() - MIN_AUTO_TOPUP_INTERVAL_MS) } }
      ]
    },
    data: { autoTopUpLastTriggeredAt: new Date() }
  });
  if (claimed.count === 0) return; // concurrent deduction already triggered this

  // Lazy-require stripe to avoid circular deps at module load time
  const Stripe = require('stripe');
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  const tokensToAdd = user.autoTopUpAmountCents * TOKENS_PER_CENT;

  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: user.autoTopUpAmountCents,
      currency: 'usd',
      customer: user.stripeCustomerId,
      payment_method: user.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        type: 'auto_topup',
        userId,
        tokensToAdd: tokensToAdd.toString()
      }
    });
  } catch (err) {
    // Only roll back the cooldown on errors where we are certain no charge was created:
    // card_error = card declined before charge attempt; invalid_request_error = bad params.
    // Network errors, timeouts, or unknown errors leave the cooldown in place — Stripe may
    // have already accepted the charge and a retry without an idempotency key would double-bill.
    const safeToRetry = err.type === 'StripeCardError' || err.type === 'StripeInvalidRequestError';
    if (safeToRetry) {
      await prisma.user.update({ where: { id: userId }, data: { autoTopUpLastTriggeredAt: null } })
        .catch(e => console.error('[AutoTopUp] Failed to clear cooldown after PI error:', e.message));
    }
    console.error(`[AutoTopUp] Stripe PI creation failed (cooldown ${safeToRetry ? 'cleared' : 'preserved'}):`, err.message);
    return;
  }

  // Credit immediately on synchronous success using pi.id as the idempotency key.
  // The payment_intent.succeeded webhook uses the same key, so exactly one path wins.
  if (pi.status === 'succeeded') {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.stripeEvent.create({ data: { stripeEventId: pi.id } });
        await tx.user.update({
          where: { id: userId },
          data: { tokenBalance: { increment: BigInt(tokensToAdd) } }
        });
      });
      console.log(`[AutoTopUp] Credited ${tokensToAdd} tokens synchronously for ${userId} (${pi.id})`);
    } catch (err) {
      if (err.code !== 'P2002') throw err; // P2002 = webhook already credited first, skip
    }
  } else {
    console.log(`[AutoTopUp] PaymentIntent ${pi.id} status: ${pi.status} — webhook will credit tokens`);
  }
}

// Returns true if the user has tokens remaining.
async function hasTokens(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenBalance: true }
  });
  return user ? user.tokenBalance > 0n : false;
}

// Add tokens to a user's balance (after payment).
async function addTokens(userId, amount) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenBalance: { increment: BigInt(amount) } }
  });
}

// Deduct a flat cost (in cents) — used for Whisper, Brave, etc.
// e.g. deductFlat(userId, 0.3) for a $0.003 Brave search
async function deductFlat(userId, cents) {
  const tokens = BigInt(Math.ceil(cents * TOKENS_PER_CENT));
  if (tokens === 0n) return;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      tokenBalance: { decrement: tokens },
      tokensUsed: { increment: tokens }
    },
    select: {
      tokenBalance: true,
      autoTopUpEnabled: true,
      autoTopUpAmountCents: true,
      autoTopUpThresholdCents: true,
      autoTopUpLastTriggeredAt: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true
    }
  });

  if (shouldAutoTopUp(updated)) {
    triggerAutoTopUp(userId, updated).catch(err =>
      console.error('[AutoTopUp] Failed:', err.message)
    );
  }
}

module.exports = { deductTokens, deductFlat, hasTokens, addTokens, TOKENS_PER_CENT };
