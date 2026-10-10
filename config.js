const path = require("path");

module.exports = {
  BOT_NAME: process.env.BOT_NAME || "𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂",
  PREFIX: process.env.PREFIX || ",",
  OWNER_NUMBER: (process.env.OWNER_NUMBER || "94719845166").replace(/[^0-9]/g, ""),
  PORT: process.env.PORT || 3000,
  LOGO: process.env.LOGO || path.join(__dirname, "logo.jpg")
};
