const { Resend } = require('resend');

const getFrom = () => process.env.EMAIL_FROM || 'Brutus AI <noreply@brutusai.coach>';
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
          verify your email to unlock your 500,000 free tokens. brutus is waiting.
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
    subject: 'reset your brutus password',
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


module.exports = { sendVerificationEmail, sendPasswordResetEmail };
