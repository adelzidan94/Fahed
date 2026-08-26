const express = require("express");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// الاتصال بقاعدة البيانات
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// إنشاء جدول الذاكرة تلقائيًا
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Fahed memory database is ready");
}

// شخصية فهد
const FAEHAD_INSTRUCTIONS = `
أنت فهد، مساعد ذكي شخصي.

مهمتك:
- مساعدة المستخدم بطريقة واضحة ومباشرة.
- التحدث باللغة العربية بشكل طبيعي، إلا إذا طلب المستخدم لغة أخرى.
- فهم سؤال المستخدم والرد عليه بدقة.
- إذا كانت المعلومة غير مؤكدة، لا تخترعها.
- لا تدّعي امتلاك قدرات أو أدوات غير متاحة لك.
- كن عمليًا وودودًا.
- عندما يحتاج المستخدم إلى شرح، اشرح له خطوة بخطوة.

الذاكرة:
- لديك ذاكرة دائمة للمعلومات التي يطلب المستخدم منك حفظها.
- لا تفترض أن كل معلومة يقولها المستخدم يجب حفظها.
- عندما يقول المستخدم بوضوح "تذكر" أو "احفظ" أو "سجل"، يمكن حفظ المعلومة.
- عندما يقول المستخدم "انسَ" أو "احذف من ذاكرتك"، يجب التعامل مع ذلك كطلب لحذف المعلومة.
`;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/chat", async (req, res) => {
  try {
    const text = req.body.message;

    if (!text) {
      return res.status(400).json({
        error: "الرسالة فارغة"
      });
    }

    // استرجاع الذاكرة
    const memoriesResult = await pool.query(`
      SELECT content
      FROM memories
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const memories = memoriesResult.rows
      .map(row => `- ${row.content}`)
      .join("\n");

    const input = `
ذكريات فهد المحفوظة عن المستخدم:
${memories || "لا توجد ذكريات محفوظة حتى الآن."}

رسالة المستخدم:
${text}
`;

    const response = await client.responses.create({
      model: "gpt-5-mini",
      instructions: FAEHAD_INSTRUCTIONS,
      input: input
    });

    const reply = response.output_text;

    // حفظ المعلومة عندما يطلب المستخدم ذلك صراحةً
    const saveWords = [
      "تذكر",
      "تذكّر",
      "احفظ",
      "سجل",
      "سجّل",
      "خلي ببالك",
      "خليه بذاكرتك"
    ];

    const wantsSave = saveWords.some(word =>
      text.toLowerCase().includes(word)
    );

    if (wantsSave) {
      await pool.query(
        "INSERT INTO memories (content) VALUES ($1)",
        [text]
      );

      console.log("Memory saved:", text);
    }

    res.json({
      reply: reply
    });

  } catch (error) {
    console.error("OpenAI/Database Error:", error);

    res.status(500).json({
      error: error.message || "حدث خطأ أثناء الاتصال بفهد"
    });
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Fahed is running on port " + PORT);

  try {
    await initDatabase();
  } catch (error) {
    console.error("Database initialization error:", error);
  }
});
