const mongoose = require("mongoose");
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
const config = require("../config");

const AuthSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  data: { type: String, required: true }
});

const AuthModel = mongoose.model("SessionAuth", AuthSchema);

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

  const writeData = async (data, id) => {
    try {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await AuthModel.updateOne({ id }, { data: serialized }, { upsert: true });
    } catch (err) {
      console.error(`Error saving ${id}:`, err);
    }
  };

  const readData = async (id) => {
    try {
      const record = await AuthModel.findOne({ id });
      if (!record) return null;
      return JSON.parse(record.data, BufferJSON.reviver);
    } catch (err) {
      return null;
    }
  };

  const removeData = async (id) => {
    try {
      await AuthModel.deleteOne({ id });
    } catch (err) {
      console.error(`Error removing ${id}:`, err);
    }
  };

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                await writeData(value, key);
              } else {
                await removeData(key);
              }
            }
          }
        }
      }
    },
    saveCreds: () => writeData(creds, "creds")
  };
}

module.exports = { useMongoAuthState, connectMongo };
