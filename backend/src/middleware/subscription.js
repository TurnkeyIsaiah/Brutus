// Middleware to gate routes behind a non-zero token balance.
// Must be used AFTER the authenticate middleware.
const checkTokenBalance = (req, res, next) => {
  if (req.user.tokenBalance <= 0n) {
    return res.status(403).json({
      error: {
        message: "you're out of tokens. add credits to keep Brutus working.",
        code: 'OUT_OF_TOKENS'
      }
    });
  }
  next();
};

module.exports = { checkTokenBalance };
