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
  if (!pool) return [];

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
  if (!pool || !content) return;

  const cleanContent = content.trim();

  if (!cleanContent) return;

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

    if (existing.rows.length > 0) return;

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
  if (!pool) return;

  try {
    await pool.query("DELETE FROM memories");
    console.log("All memories deleted");
  } catch (error) {
    console.error("Delete memories error:", error);
  }
}

// ===============================
// حذف ذاكرة تحتوي على نص
// ===============================

async function deleteMemoryContaining(text) {
  if (!pool || !text) return false;

  try {
    const result = await pool.query(
      `
      DELETE FROM memories
      WHERE LOWER(content) LIKE LOWER($1)
      `,
      [`%${text}%`]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.error("Delete memory error:", error);
    return false;
  }
}

// ===============================
// تحديث ذاكرة
// ===============================

async function updateMemory(oldText, newText) {
  if (!pool || !oldText || !newText) return false;

  try {
    const result = await pool.query(
      `
      UPDATE memories
      SET content = $1
      WHERE LOWER(content) LIKE LOWER($2)
      `,
      [newText.trim(), `%${oldText.trim()}%`]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.error("Update memory error:", error);
    return false;
  }
}

// ===============================
// استخراج الذاكرة
// ===============================

function extractMemory(text) {
  const lower = text.toLowerCase();

  const phrases = [
    "تذكر أن",
    "تذكر ان",
    "احفظ أن",
    "احفظ ان",
    "تذكر بأن",
    "تذكر بان",
    "لا تنسى أن",
    "لا تنسى ان"
  ];

  for (const phrase of phrases) {
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
// اكتشاف المعلومات المباشرة
// ===============================

function extractSmartMemory(text) {
  const lower = text.toLowerCase().trim();

  // الاسم
  const nameMatch = lower.match(
    /(?:اسمي|أنا اسمي|انا اسمي)\s+(.+)/i
  );

  if (nameMatch) {
    return {
      type: "name",
      value: nameMatch[1].trim(),
      content: `اسمي ${nameMatch[1].trim()}`
    };
  }

  // اللون المفضل
  const colorMatch = lower.match(
    /(?:لوني المفضل|اللون المفضل لدي|اللون المفضل عندي)\s+(?:هو\s+)?(.+)/i
  );

  if (colorMatch) {
    return {
      type: "favorite_color",
      value: colorMatch[1].trim(),
      content: `لوني المفضل هو ${colorMatch[1].trim()}`
    };
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
// طلب حذف كل الذاكرة
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
// طلب حذف معلومة محددة
// ===============================

function extractForgetRequest(text) {
  const patterns = [
    /انسَ\s+(?:أن\s+)?(.+)/i,
    /انس\s+(?:أن\s+)?(.+)/i,
    /انسى\s+(?:أن\s+)?(.+)/i,
    /احذف\s+(?:أن\s+)?(.+)/i,
    /امسح\s+(?:أن\s+)?(.+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// ===============================
// طلب تغيير معلومة
// ===============================

function extractUpdateRequest(text) {
  const patterns = [
    {
      regex: /غيّر\s+لوني\s+المفضل\s+(?:إلى|الى)\s+(.+)/i,
      oldText: "لوني المفضل"
    },
    {
      regex: /غير\s+لوني\s+المفضل\s+(?:إلى|الى)\s+(.+)/i,
      oldText: "لوني المفضل"
    },
    {
      regex: /غيّر\s+اسمي\s+(?:إلى|الى)\s+(.+)/i,
      oldText: "اسمي"
    },
    {
      regex: /غير\s+اسمي\s+(?:إلى|الى)\s+(.+)/i,
      oldText: "اسمي"
    }
  ];

  for (const item of patterns) {
    const match = text.match(item.regex);

    if (match) {
      let newValue = match[1].trim();

      if (item.oldText === "لوني المفضل") {
        newValue = `لوني المفضل هو ${newValue}`;
      }

      if (item.oldText === "اسمي") {
        newValue = `اسمي ${newValue}`;
      }

      return {
        oldText: item.oldText,
        newText: newValue
      };
    }
  }

  return null;
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
        reply: `هذه المعلومات التي أتذكرها عنك:\n\n${memoryList}`
      });
    }

    // ===========================
    // حذف كل الذاكرة
    // ===========================

    if (isForgetAllRequest(cleanText)) {
      await deleteAllMemories();

      return res.json({
        reply: "تم حذف جميع الذكريات المحفوظة لدى فهد."
      });
    }

    // ===========================
    // تغيير معلومة
    // ===========================

    const updateRequest = extractUpdateRequest(cleanText);

    if (updateRequest) {
      const updated = await updateMemory(
        updateRequest.oldText,
        updateRequest.newText
      );

      if (updated) {
        return res.json({
          reply: "تم تحديث المعلومة في ذاكرتي."
        });
      }

      await saveMemory(updateRequest.newText);

      return res.json({
        reply: "لم تكن المعلومة القديمة موجودة، لذلك حفظت المعلومة الجديدة."
      });
    }

    // ===========================
    // حذف معلومة محددة
    // ===========================

    const forgetText = extractForgetRequest(cleanText);

    if (forgetText) {
      const deleted = await deleteMemoryContaining(forgetText);

      if (deleted) {
        return res.json({
          reply: "تم حذف هذه المعلومة من ذاكرتي."
        });
      }

      return res.json({
        reply: "لم أجد هذه المعلومة في ذاكرتي."
      });
    }

    // ===========================
    // حفظ ذاكرة صريحة
    // ===========================

    const explicitMemory = extractMemory(cleanText);

    if (explicitMemory) {
      await saveMemory(explicitMemory);
    }

    // ===========================
    // حفظ ذاكرة ذكية
    // ===========================

    const smartMemory = extractSmartMemory(cleanText);

    if (smartMemory) {

      if (smartMemory.type === "name") {
        await updateMemory("اسمي", smartMemory.content);

        const existing = await getMemories();

        const alreadyExists = existing.some(item =>
          item.content.toLowerCase() ===
          smartMemory.content.toLowerCase()
        );

        if (!alreadyExists) {
          await saveMemory(smartMemory.content);
        }
      }

      if (smartMemory.type === "favorite_color") {
        await updateMemory(
          "لوني المفضل",
          smartMemory.content
        );

        const existing = await getMemories();

        const alreadyExists = existing.some(item =>
          item.content.toLowerCase() ===
          smartMemory.content.toLowerCase()
        );

        if (!alreadyExists) {
          await saveMemory(smartMemory.content);
        }
      }
    }

    // ===========================
    // قراءة الذاكرة
    // ===========================

    const memories = await getMemories();

    let memoryText = "";

    if (memories.length > 0) {
      memoryText = `
هذه معلومات محفوظة من المستخدم:

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

تحدث باللغة العربية عندما يتحدث المستخدم بالعربية.

كن واضحًا ومباشرًا وودودًا.

استخدم المعلومات المحفوظة عندما تكون مرتبطة بسؤال المستخدم.

لا تخترع ذكريات غير موجودة.

إذا سأل المستخدم عن معلومات محفوظة، استخدم الذاكرة الفعلية فقط.

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
      reply: response.output_text ||
        "لم أتمكن من إنشاء إجابة."
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
