const mongoose = require("mongoose");
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/HESHAN-MD?retryWrites=true&w=majority&appName=Cluster0";

const AuthSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  data: { type: String, required: true }
});

const AuthModel = mongoose.models.SessionAuth || mongoose.model("SessionAuth", AuthSchema);

let isConnected = false;

async function connectMongo() {
  if (!isConnected) {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log("⚡ [DATABASE] MongoDB Atlas Connected Successfully");
  }
}

// In-Memory Fast Cache Layer (C++ speed key-value lookup)
const memoryCache = new Map();

async function useMongoAuthState() {
  await connectMongo();

  const writeData = async (data, id) => {
    try {
      memoryCache.set(id, data);
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await AuthModel.updateOne({ id }, { data: serialized }, { upsert: true });
    } catch (err) {
      console.error(`Save error (${id}):`, err.message);
    }
  };

  const readData = async (id) => {
    try {
      if (memoryCache.has(id)) return memoryCache.get(id);
      const record = await AuthModel.findOne({ id }).lean();
      if (!record?.data) return null;
      const parsed = JSON.parse(record.data, BufferJSON.reviver);
      memoryCache.set(id, parsed);
      return parsed;
    } catch (err) {
      return null;
    }
  };

  const removeData = async (id) => {
    try {
      memoryCache.delete(id);
      await AuthModel.deleteOne({ id });
    } catch (err) {
      console.error(`Remove error (${id}):`, err.message);
    }
  };

  const clearSession = async () => {
    memoryCache.clear();
    await AuthModel.deleteMany({});
  };

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
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
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, "creds"),
    clearSession
  };
}

module.exports = { useMongoAuthState, connectMongo };
