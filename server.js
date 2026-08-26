const express = require("express");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// ===============================
// OpenAI
// ===============================

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===============================
// PostgreSQL
// ===============================

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  console.log("PostgreSQL: DATABASE_URL detected");
} else {
  console.log("PostgreSQL: DATABASE_URL not found");
}

// ===============================
// الصفحة الرئيسية
// ===============================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ===============================
// Health Check
// ===============================

app.get("/health", async (req, res) => {
  let database = "not configured";

  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = "connected";
    } catch (error) {
      database = "error";
    }
  }

  res.json({
    status: "ok",
    fahed: "online",
    database
  });
});

// ===============================
// إنشاء جدول الذاكرة
// ===============================

async function initializeDatabase() {
  if (!pool) {
    console.log("Database initialization skipped");
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Database initialized");
  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

// ===============================
// جلب الذاكرة
// ===============================

async function getMemories() {
  if (!pool) {
    return [];
  }

  try {
    const result = await pool.query(`
      SELECT id, content, created_at
      FROM memories
      ORDER BY created_at DESC
      LIMIT 50
    `);

    return result.rows;
  } catch (error) {
    console.error("Get memories error:", error);
    return [];
  }
}

// ===============================
// حفظ ذاكرة
// ===============================

async function saveMemory(content) {
  if (!pool || !content) {
    return;
  }

  const cleanContent = content.trim();

  if (!cleanContent) {
    return;
  }

  try {
    const existing = await pool.query(
      `
      SELECT id
      FROM memories
      WHERE LOWER(content) = LOWER($1)
      LIMIT 1
      `,
      [cleanContent]
    );

    if (existing.rows.length > 0) {
      return;
    }

    await pool.query(
      `
      INSERT INTO memories (content)
      VALUES ($1)
      `,
      [cleanContent]
    );

    console.log("Memory saved:", cleanContent);
  } catch (error) {
    console.error("Save memory error:", error);
  }
}

// ===============================
// حذف جميع الذكريات
// ===============================

async function deleteAllMemories() {
  if (!pool) {
    return;
  }

  try {
    await pool.query("DELETE FROM memories");
    console.log("All memories deleted");
  } catch (error) {
    console.error("Delete memories error:", error);
  }
}

// ===============================
// حذف ذاكرة محددة
// ===============================

async function deleteSpecificMemory(text) {
  if (!pool || !text) {
    return false;
  }

  const lower = text.toLowerCase();

  const phrases = [
    "انسَ أن",
    "انس ان",
    "انسَ ان",
    "انسى أن",
    "انسى ان",
    "احذف أن",
    "احذف ان",
    "احذف ذاكرة",
    "امسح ذاكرة"
  ];

  for (const phrase of phrases) {
    const index = lower.indexOf(phrase.toLowerCase());

    if (index !== -1) {
      const memoryText = text
        .substring(index + phrase.length)
        .trim();

      if (!memoryText) {
        return false;
      }

      try {
        const result = await pool.query(
          `
          DELETE FROM memories
          WHERE LOWER(content) = LOWER($1)
          `,
          [memoryText]
        );

        return result.rowCount > 0;
      } catch (error) {
        console.error("Delete specific memory error:", error);
        return false;
      }
    }
  }

  return false;
}

// ===============================
// استخراج الذاكرة من رسالة المستخدم
// ===============================

function extractMemory(text) {
  const lower = text.toLowerCase();

  const memoryPhrases = [
    "تذكر أن",
    "تذكر ان",
    "احفظ أن",
    "احفظ ان",
    "تذكر بأن",
    "تذكر بان",
    "لا تنسى أن",
    "لا تنسى ان"
  ];

  for (const phrase of memoryPhrases) {
    const index = lower.indexOf(phrase.toLowerCase());

    if (index !== -1) {
      const memory = text
        .substring(index + phrase.length)
        .trim();

      if (memory.length > 2) {
        return memory;
      }
    }
  }

  return null;
}

// ===============================
// طلب عرض الذاكرة
// ===============================

function isMemoryListRequest(text) {
  const phrases = [
    "ماذا تتذكر عني",
    "ماذا تتذكر",
    "ما الذي تتذكره عني",
    "ما الذي تتذكره",
    "اعرض ذاكرتك",
    "اعرض الذاكرة",
    "عرض الذاكرة",
    "ذكرياتي",
    "ما هي ذكرياتي"
  ];

  const lower = text.toLowerCase();

  return phrases.some(phrase =>
    lower.includes(phrase.toLowerCase())
  );
}

// ===============================
// طلب حذف جميع الذاكرة
// ===============================

function isForgetAllRequest(text) {
  const phrases = [
    "انسَ كل شيء",
    "انس كل شيء",
    "انسى كل شيء",
    "انسَ كل الذاكرة",
    "انس كل الذاكرة",
    "انسى كل الذاكرة",
    "احذف الذاكرة كلها",
    "امسح الذاكرة كلها",
    "احذف كل الذكريات",
    "امسح كل الذكريات"
  ];

  const lower = text.toLowerCase();

  return phrases.some(phrase =>
    lower.includes(phrase.toLowerCase())
  );
}

// ===============================
// API المحادثة
// ===============================

app.post("/api/chat", async (req, res) => {
  try {
    const text = req.body.message;

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "الرسالة فارغة"
      });
    }

    const cleanText = text.trim();

    // ===========================
    // عرض الذاكرة
    // ===========================

    if (isMemoryListRequest(cleanText)) {
      const memories = await getMemories();

      if (memories.length === 0) {
        return res.json({
          reply: "لا توجد لدي ذكريات محفوظة عنك حاليًا."
        });
      }

      const memoryList = memories
        .map((item, index) => `${index + 1}. ${item.content}`)
        .join("\n");

      return res.json({
        reply:
          `هذه المعلومات التي أتذكرها عنك:\n\n${memoryList}`
      });
    }

    // ===========================
    // حذف جميع الذاكرة
    // ===========================

    if (isForgetAllRequest(cleanText)) {
      await deleteAllMemories();

      return res.json({
        reply: "تم حذف جميع الذكريات المحفوظة لدى فهد."
      });
    }

    // ===========================
    // حذف ذاكرة محددة
    // ===========================

    const deleted = await deleteSpecificMemory(cleanText);

    if (deleted) {
      return res.json({
        reply: "تم حذف هذه المعلومة من ذاكرتي."
      });
    }

    // ===========================
    // حفظ ذاكرة إذا طلب المستخدم
    // ===========================

    const memory = extractMemory(cleanText);

    if (memory) {
      await saveMemory(memory);
    }

    // ===========================
    // قراءة الذاكرة
    // ===========================

    const memories = await getMemories();

    let memoryText = "";

    if (memories.length > 0) {
      memoryText = `
هذه معلومات محفوظة من المستخدم ويمكن استخدامها عندما تكون مرتبطة بالسؤال:

${memories
  .map((item, index) => `${index + 1}. ${item.content}`)
  .join("\n")}
`;
    }

    // ===========================
    // تعليمات فهد
    // ===========================

    const instructions = `
أنت "فهد"، مساعد ذكي شخصي.

اسم المستخدم هو عادل إذا كانت هذه المعلومة موجودة في الذاكرة.

تحدث باللغة العربية عندما يتحدث المستخدم بالعربية.

كن واضحًا ومباشرًا وودودًا.

لا تدّعي أنك تستطيع تنفيذ شيء لا تستطيع تنفيذه.

إذا كانت هناك معلومات محفوظة عن المستخدم، استخدمها فقط عندما تكون مرتبطة بالسؤال.

لا تخبر المستخدم أنك تتذكر معلومة إذا لم تكن موجودة فعلًا في الذاكرة.

${memoryText}
`;

    // ===========================
    // OpenAI Responses API
    // ===========================

    const response = await client.responses.create({
      model: "gpt-5-mini",
      instructions,
      input: cleanText
    });

    res.json({
      reply: response.output_text || "لم أتمكن من إنشاء إجابة."
    });

  } catch (error) {
    console.error("OpenAI/Database Error:", error);

    res.status(500).json({
      error:
        error.message ||
        "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي"
    });
  }
});

// ===============================
// تشغيل السيرفر
// ===============================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Fahed is running on port " + PORT);

  await initializeDatabase();
});
