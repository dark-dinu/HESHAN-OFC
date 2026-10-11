const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true }
});

const Session = mongoose.model('Session', sessionSchema);

async function useMongoDBAuthState(collectionName) {
    const writeData = async (data, id) => {
        await Session.updateOne({ id }, { data: JSON.stringify(data, null, 2) }, { upsert: true });
    };
    
    const readData = async (id) => {
        const found = await Session.findOne({ id });
        return found ? JSON.parse(found.data) : null;
    };
    
    const removeData = async (id) => {
        await Session.deleteOne({ id });
    };

    // Baileys requires state and saveCreds functions. 
    // (For a production app, use standard Baileys MongoDB adapters, 
    // but this sets the basic logic for creds storage).
    
    return { writeData, readData, removeData };
}

module.exports = { useMongoDBAuthState };
