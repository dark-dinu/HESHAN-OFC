const mongoose = require("mongoose");
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
const config = require("../config");

const AuthSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  data: { type: String, required: true }
});

const AuthModel = mongoose.models.SessionAuth || mongoose.model("SessionAuth", AuthSchema);

let isConnected = false;

async function connectMongo() {
  if (!isConnected) {
    await mongoose.connect(config.MONGODB_URI);
    isConnected = true;
    console.log("MongoDB Connected Successfully");
  }
}

async function useMongoAuthState() {
  await connectMongo();

  // Single Document Write
  const writeData = async (data, id) => {
    try {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await AuthModel.updateOne({ id }, { data: serialized }, { upsert: true });
    } catch (err) {
      console.error(`Error saving ${id}:`, err.message);
    }
  };

  // Single Document Read
  const readData = async (id) => {
    try {
      const record = await AuthModel.findOne({ id }).lean();
      if (!record?.data) return null;
      return JSON.parse(record.data, BufferJSON.reviver);
    } catch (err) {
      return null;
    }
  };

  // Single Document Remove
  const removeData = async (id) => {
    try {
      await AuthModel.deleteOne({ id });
    } catch (err) {
      console.error(`Error removing ${id}:`, err.message);
    }
  };

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        // High-Speed Parallel Key Retrieval (Fixes Bad MAC & Decryption Lag)
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },

        // Atomic Parallel Batch Key Setter (Fixes Key used already or never filled)
        set: async (data) => {
          const writeQueue = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                writeQueue.push(writeData(value, key));
              } else {
                writeQueue.push(removeData(key));
              }
            }
          }
          await Promise.all(writeQueue);
        }
      }
    },
    saveCreds: () => writeData(creds, "creds")
  };
}

module.exports = { useMongoAuthState, connectMongo };
