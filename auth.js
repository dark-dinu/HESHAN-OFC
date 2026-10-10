const mongoose = require("mongoose");
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");

// ⚠️ Password එක code එකේ ලියන්න එපා. Render > Environment > MONGODB_URI
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("❌ MONGODB_URI environment variable එක set කරලා නෑ!");
  process.exit(1);
}

const AuthModel =
  mongoose.models.SessionAuth ||
  mongoose.model(
    "SessionAuth",
    new mongoose.Schema({
      id: { type: String, required: true, unique: true },
      data: { type: String, required: true }
    })
  );

let connecting = null;
function connectMongo() {
  if (!connecting) {
    connecting = mongoose
      .connect(MONGO_URI, { serverSelectionTimeoutMS: 20000 })
      .then(() => console.log("⚡ [DATABASE] MongoDB Connected"))
      .catch((e) => {
        connecting = null; // ඊළඟ වතාවේ ආයෙ try කරන්න
        throw e;
      });
  }
  return connecting;
}

const memoryCache = new Map();
const writeQueue = new Map(); // key එකකට writes පිළිවෙලට

function enqueue(id, job) {
  const prev = writeQueue.get(id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(job)
    .catch((e) => console.error(`DB error (${id}):`, e.message));
  writeQueue.set(id, next);
  next.finally(() => {
    if (writeQueue.get(id) === next) writeQueue.delete(id);
  });
  return next;
}

// Restart / SIGTERM වෙද්දී pending writes ඔක්කොම DB එකට යනකම් බලන් ඉන්න
async function flushWrites() {
  while (writeQueue.size) await Promise.all([...writeQueue.values()]);
}

async function useMongoAuthState() {
  await connectMongo();

  const writeData = (data, id) => {
    memoryCache.set(id, data);
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    return enqueue(id, () => AuthModel.updateOne({ id }, { data: serialized }, { upsert: true }));
  };

  const readData = async (id) => {
    if (memoryCache.has(id)) return memoryCache.get(id);
    try {
      const record = await AuthModel.findOne({ id }).lean();
      if (!record?.data) return null;
      const parsed = JSON.parse(record.data, BufferJSON.reviver);
      memoryCache.set(id, parsed);
      return parsed;
    } catch (err) {
      console.error(`Read error (${id}):`, err.message);
      return null;
    }
  };

  const removeData = (id) => {
    memoryCache.delete(id);
    return enqueue(id, () => AuthModel.deleteOne({ id }));
  };

  const clearSession = async () => {
    await flushWrites();
    memoryCache.clear();
    await AuthModel.deleteMany({});
  };

  const creds = (await readData("creds")) || initAuthCreds();
  memoryCache.set("creds", creds);

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
              tasks.push(value ? writeData(value, key) : removeData(key));
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

module.exports = { useMongoAuthState, connectMongo, flushWrites };
