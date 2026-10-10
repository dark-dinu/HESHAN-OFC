const path = require("path");

module.exports = {
  BOT_NAME: process.env.BOT_NAME || "𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂",
  PREFIX: process.env.PREFIX || ",",
  
  // Owner Number (Spaces හෝ '+' නැතිව අංක පමණක් sanitize කර ගනී)
  OWNER_NUMBER: (process.env.OWNER_NUMBER || "94719845166").replace(/[^0-9]/g, ""),
  
  // MongoDB Atlas Database URI
  MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/HESHAN-MD?retryWrites=true&w=majority&appName=Cluster0",
  
  // Web Server Port (Render auto-assigned PORT එකට මුල්තැන දෙයි)
  PORT: process.env.PORT || 3000,
  
  // Bot Logo Image Path
  LOGO: process.env.LOGO || path.join(__dirname, "logo.jpg")
};
