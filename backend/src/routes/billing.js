const express = require('express');
const Stripe = require('stripe');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { addTokens, TOKENS_PER_CENT } = require('../lib/tokens');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const MIN_AMOUNT_CENTS = 1000; // $10 minimum

// Preset token packs
const TOKEN_PACKS = {
  starter: { tokens: 500_000,    amountCents: 1000,  label: 'Starter — 500K tokens' },  // $10
  grind:   { tokens: 2_000_000,  amountCents: 2900,  label: 'Grind — 2M tokens' },       // $29
  closer:  { tokens: 5_000_000,  amountCents: 5900,  label: 'Closer — 5M tokens' },      // $59
  team:    { tokens: 20_000_000, amountCents: 19900, label: 'Team — 20M tokens' },       // $199
};

// Ensure the user has a Stripe customer record; returns customerId
async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id }
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id }
  });
  return customer.id;
}

// Build a Stripe Checkout session for a one-time payment.
// setup_future_usage saves the card for auto top-up.
async function createCheckoutSession(customerId, amountCents, label, tokensToAdd, userId) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'payment',
    payment_intent_data: { setup_future_usage: 'off_session' },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: label }
      }
    }],
    success_url: `${process.env.APP_URL}/credits-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/index.html`,
    metadata: { userId, tokensToAdd: tokensToAdd.toString() }
  });
}

// ==================== GET BALANCE ====================

router.get('/balance', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        tokenBalance: true,
        tokensUsed: true,
        stripePaymentMethodId: true,
        autoTopUpEnabled: true,
        autoTopUpAmountCents: true,
        autoTopUpThresholdCents: true
      }
    });

    res.json({
      tokenBalance: user.tokenBalance.toString(),
      tokensUsed: user.tokensUsed.toString(),
      hasSavedCard: !!user.stripePaymentMethodId,
      autoTopUp: {
        enabled: user.autoTopUpEnabled,
        amountDollars: user.autoTopUpAmountCents / 100,
        thresholdDollars: user.autoTopUpThresholdCents / 100
      },
      packs: Object.entries(TOKEN_PACKS).map(([id, p]) => ({
        id,
        label: p.label,
        tokens: p.tokens,
        price: p.amountCents / 100
      }))
    });
  } catch (error) {
    next(error);
  }
});

// ==================== BUY PRESET PACK ====================

router.post('/add-credits', authenticate, async (req, res, next) => {
  try {
    const { pack } = req.body;
    const selected = TOKEN_PACKS[pack];
    if (!selected) {
      return res.status(400).json({
        error: { message: `Invalid pack. Choose: ${Object.keys(TOKEN_PACKS).join(', ')}` }
      });
    }

    const customerId = await ensureCustomer(req.user);
    const session = await createCheckoutSession(
      customerId,
      selected.amountCents,
      selected.label,
      selected.tokens,
      req.user.id
    );

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// ==================== CUSTOM TOP-UP ====================

router.post('/custom-topup', authenticate, async (req, res, next) => {
  try {
    const { amountDollars } = req.body;
    const amount = parseFloat(amountDollars);

    if (!amount || isNaN(amount) || amount < 10) {
      return res.status(400).json({
        error: { message: 'Minimum top-up amount is $10' }
      });
    }

    const amountCents = Math.round(amount * 100);
    const tokensToAdd = amountCents * TOKENS_PER_CENT;
    const label = `Brutus AI Credits — $${amount.toFixed(2)}`;

    const customerId = await ensureCustomer(req.user);
    const session = await createCheckoutSession(
      customerId,
      amountCents,
      label,
      tokensToAdd,
      req.user.id
    );

    res.json({ url: session.url, tokensToAdd });
  } catch (error) {
    next(error);
  }
});

// ==================== GET AUTO TOP-UP SETTINGS ====================

router.get('/auto-topup', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        autoTopUpEnabled: true,
        autoTopUpAmountCents: true,
        autoTopUpThresholdCents: true,
        stripePaymentMethodId: true,
        autoTopUpLastTriggeredAt: true
      }
    });

    res.json({
      enabled: user.autoTopUpEnabled,
      amountDollars: user.autoTopUpAmountCents / 100,
      thresholdDollars: user.autoTopUpThresholdCents / 100,
      hasSavedCard: !!user.stripePaymentMethodId,
      lastTriggeredAt: user.autoTopUpLastTriggeredAt
    });
  } catch (error) {
    next(error);
  }
});

// ==================== UPDATE AUTO TOP-UP SETTINGS ====================

router.put('/auto-topup', authenticate, async (req, res, next) => {
  try {
    const { enabled, amountDollars, thresholdDollars } = req.body;

    if (enabled) {
      if (!amountDollars || parseFloat(amountDollars) < 10) {
        return res.status(400).json({
          error: { message: 'Auto top-up amount must be at least $10' }
        });
      }
      if (!thresholdDollars || parseFloat(thresholdDollars) < 10) {
        return res.status(400).json({
          error: { message: 'Auto top-up threshold must be at least $10' }
        });
      }

      // Require a saved card before enabling
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { stripePaymentMethodId: true }
      });
      if (!user.stripePaymentMethodId) {
        return res.status(400).json({
          error: {
            message: 'No saved payment method. Make a purchase first to save your card.',
            code: 'NO_SAVED_CARD'
          }
        });
      }
    }

    const data = { autoTopUpEnabled: !!enabled };
    if (amountDollars !== undefined) {
      data.autoTopUpAmountCents = Math.round(parseFloat(amountDollars) * 100);
    }
    if (thresholdDollars !== undefined) {
      data.autoTopUpThresholdCents = Math.round(parseFloat(thresholdDollars) * 100);
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        autoTopUpEnabled: true,
        autoTopUpAmountCents: true,
        autoTopUpThresholdCents: true
      }
    });

    res.json({
      enabled: updated.autoTopUpEnabled,
      amountDollars: updated.autoTopUpAmountCents / 100,
      thresholdDollars: updated.autoTopUpThresholdCents / 100
    });
  } catch (error) {
    next(error);
  }
});

// ==================== STRIPE WEBHOOK ====================
// Registered before express.json() in index.js

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Stripe] Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.mode !== 'payment') break;

          const { userId, tokensToAdd } = session.metadata || {};
          if (!userId || !tokensToAdd) {
            console.error('[Stripe] Missing metadata on session:', session.id);
            break;
          }

          // Credit tokens
          await addTokens(userId, parseInt(tokensToAdd, 10));
          console.log(`[Stripe] Credited ${tokensToAdd} tokens to user ${userId}`);

          // Save payment method from the payment intent for future auto top-ups
          if (session.payment_intent) {
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
            if (pi.payment_method) {
              await prisma.user.update({
                where: { id: userId },
                data: { stripePaymentMethodId: pi.payment_method }
              });
              console.log(`[Stripe] Saved payment method for user ${userId}`);
            }
          }
          break;
        }

        // Auto top-up charges that succeeded asynchronously (e.g. 3D Secure)
        case 'payment_intent.succeeded': {
          const pi = event.data.object;
          if (pi.metadata?.type !== 'auto_topup') break;

          const { userId, tokensToAdd } = pi.metadata;
          if (!userId || !tokensToAdd) break;

          await addTokens(userId, parseInt(tokensToAdd, 10));
          console.log(`[Stripe] Auto top-up: credited ${tokensToAdd} tokens to user ${userId}`);
          break;
        }

        // Auto top-up failed — disable it so the user knows to fix their card
        case 'payment_intent.payment_failed': {
          const pi = event.data.object;
          if (pi.metadata?.type !== 'auto_topup') break;

          const { userId } = pi.metadata;
          if (!userId) break;

          await prisma.user.update({
            where: { id: userId },
            data: { autoTopUpEnabled: false }
          });
          console.log(`[Stripe] Auto top-up payment failed for user ${userId} — disabled`);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Stripe] Webhook handler error:', err.message);
      return res.status(500).send('Webhook handler failed');
    }

    res.json({ received: true });
  }
);

module.exports = router;
