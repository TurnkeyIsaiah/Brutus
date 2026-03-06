const { Resend } = require('resend');

const FROM = process.env.EMAIL_FROM || 'Brutus.ai <noreply@brutus.ai>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

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

const sendWelcomeEmail = async (user) => {
  await resendSend({
    from: FROM,
    to: user.email,
    subject: 'brutus is watching. welcome.',
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a12; color: #fff; padding: 40px; border-radius: 16px;">
        <h1 style="font-size: 28px; margin-bottom: 8px;">welcome, ${user.name}.</h1>
        <p style="color: rgba(255,255,255,0.6); margin-bottom: 24px;">your trial is active. 20 calls. make them count.</p>
        <a href="${APP_URL}/index.html"
           style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #ff5050, #ff7850);
                  color: white; text-decoration: none; border-radius: 12px; font-weight: 600;">
          open brutus
        </a>
        <p style="margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.3);">
          you signed up with ${user.email}. if this wasn't you, ignore this email.
        </p>
      </div>
    `
  });
};

const sendPasswordResetEmail = async (email, token) => {
  const resetUrl = `${APP_URL}/reset-password.html?token=${token}`;
  await resendSend({
    from: FROM,
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


module.exports = { sendWelcomeEmail, sendPasswordResetEmail };
