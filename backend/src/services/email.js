const { Resend } = require('resend');

const getFrom = () => process.env.EMAIL_FROM || 'Brutus AI <noreply@brutusai.coach>';
const FROM_PERSONAL = 'Brutus AI <hello@brutusai.coach>';
const REPLY_TO = 'isaiah@turnkeyai.io';
const getAppUrl = () => process.env.APP_URL || 'https://app.brutusai.coach';

// Lazy-initialize so missing RESEND_API_KEY doesn't crash startup
let _resend = null;
const getResend = () => {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
};

const resendSend = async (payload) => {
  const { data, error } = await getResend().emails.send(payload);
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
};

const sendVerificationEmail = async (user, token) => {
  const verifyUrl = `${getAppUrl()}/verify-email.html?token=${token}`;
  await resendSend({
    from: getFrom(),
    to: user.email,
    subject: 'verify your email — claim your 500K free tokens',
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a12; color: #fff; padding: 40px; border-radius: 16px;">
        <h1 style="font-size: 28px; margin-bottom: 8px;">welcome, ${user.name}.</h1>
        <p style="color: rgba(255,255,255,0.6); margin-bottom: 24px;">
          verify your email to unlock your 500,000 free tokens. Brutus is waiting.
        </p>
        <a href="${verifyUrl}"
           style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #ff5050, #ff7850);
                  color: white; text-decoration: none; border-radius: 12px; font-weight: 600;">
          verify email
        </a>
        <p style="margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.3);">
          this link expires in 24 hours. if you didn't sign up, ignore this email.
        </p>
      </div>
    `
  });
};

const sendPasswordResetEmail = async (email, token) => {
  const resetUrl = `${getAppUrl()}/reset-password.html?token=${token}`;
  await resendSend({
    from: getFrom(),
    to: email,
    subject: 'reset your Brutus password',
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a12; color: #fff; padding: 40px; border-radius: 16px;">
        <h1 style="font-size: 24px; margin-bottom: 8px;">password reset</h1>
        <p style="color: rgba(255,255,255,0.6); margin-bottom: 24px;">
          click below to reset your password. this link expires in 1 hour.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #ff5050, #ff7850);
                  color: white; text-decoration: none; border-radius: 12px; font-weight: 600;">
          reset password
        </a>
        <p style="margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.3);">
          if you didn't request this, ignore it. your password won't change.
        </p>
      </div>
    `
  });
};


// ==================== ONBOARDING SEQUENCE ====================
// Day 1: transactional, immediate after email verification.
// Day 3 + Day 7: founder-voice nudges, reply-to Isaiah's real inbox.

const sendDay1Email = async (user) => {
  const appUrl = getAppUrl();
  await resendSend({
    from: getFrom(),
    to: user.email,
    subject: "you're verified. now run Brutus on your next call.",
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a12; color: #fff; padding: 40px; border-radius: 16px;">
        <h1 style="font-size: 26px; margin-bottom: 12px;">you're in, ${user.name}.</h1>
        <p style="color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 20px;">
          your 500,000 free tokens are loaded. Brutus is ready to judge you in real time.
        </p>
        <p style="color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 8px; font-weight: 600;">three steps:</p>
        <ol style="color: rgba(255,255,255,0.7); line-height: 1.7; margin: 0 0 24px 20px; padding: 0;">
          <li>open the desktop app (or grab it from the dashboard if you haven't yet)</li>
          <li>start a session before your next sales call</li>
          <li>let Brutus listen. the panel pops up in real time</li>
        </ol>
        <a href="${appUrl}/index.html"
           style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #ff5050, #ff7850);
                  color: white; text-decoration: none; border-radius: 12px; font-weight: 600;">
          open Brutus
        </a>
        <p style="margin-top: 28px; font-size: 13px; color: rgba(255,255,255,0.4); line-height: 1.5;">
          one tip: don't burn your tokens on test calls. get on a real one. that's the whole point.
        </p>
      </div>
    `
  });
};

const sendDay3Email = async (user) => {
  await resendSend({
    from: FROM_PERSONAL,
    reply_to: REPLY_TO,
    to: user.email,
    subject: "honest question — have you taken Brutus on a call yet?",
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; background: #fff;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">hey ${user.name},</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          isaiah here, founder of Brutus. i'm reaching out personally because i'm trying to figure out if this thing actually helps real reps close more deals.
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          i see you signed up a few days ago. did you get a chance to use Brutus on a live call yet?
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          if yes — what happened? what worked, what was annoying, what did you wish was different?
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          if no — what's holding you back? is the app confusing? did you forget? not the right fit for your role?
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
          just hit reply. i read every email.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">— isaiah</p>
      </div>
    `
  });
};

const sendDay7Email = async (user) => {
  await resendSend({
    from: FROM_PERSONAL,
    reply_to: REPLY_TO,
    to: user.email,
    subject: "did Brutus help you close anything this week?",
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; background: #fff;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">hey ${user.name},</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          it's been a week since you signed up. i've been wondering — has Brutus helped you on any calls? closed any deals? embarrassed you in real time?
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          i'm asking because honest feedback right now is more valuable than 100 polite reviews later. i need to know:
        </p>
        <ol style="font-size: 16px; line-height: 1.7; margin: 0 0 16px 20px; padding: 0;">
          <li>did you actually use it on a real call?</li>
          <li>did it help, hurt, or do nothing?</li>
          <li>would you still use it next week?</li>
        </ol>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
          reply with whatever you've got. one line is fine. brutal is better.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">— isaiah</p>
      </div>
    `
  });
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendDay1Email,
  sendDay3Email,
  sendDay7Email
};
