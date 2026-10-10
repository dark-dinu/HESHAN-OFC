const path = require("path");

module.exports = {
  BOT_NAME: process.env.BOT_NAME || "𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂",
  PREFIX: process.env.PREFIX || ",",
  
  // Owner Number (Spaces හෝ '+' නැතිව අංක පමණක් sanitize කර ගනී)
  OWNER_NUMBER: (process.env.OWNER_NUMBER || "947XXXXXXXX").replace(/[^0-9]/g, ""),
  
  // MongoDB Connection String
  MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/HESHAN-MD?retryWrites=true&w=majority&appName=Cluster0",
  
  // Web Server Port
  PORT: process.env.PORT || 3000,
  
  // Pairing Security Key
  PAIR_KEY: process.env.PAIR_KEY || "Heshan@2007",
  
  // Local File හෝ Remote Image URL දෙකටම compatible වන පරිදි
  LOGO: process.env.LOGO || path.join(__dirname, "logo.jpg")
};
