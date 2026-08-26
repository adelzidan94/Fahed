const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// شخصية فهد
const FAEHAD_INSTRUCTIONS = `
أنت فهد، مساعد ذكي شخصي.

مهمتك:
- مساعدة المستخدم بطريقة واضحة ومباشرة.
- التحدث باللغة العربية بشكل طبيعي، إلا إذا طلب المستخدم لغة أخرى.
- فهم سؤال المستخدم والرد عليه بدقة.
- إذا كانت المعلومة غير مؤكدة، لا تخترعها.
- لا تدّعي امتلاك قدرات أو أدوات غير متاحة لك.
- كن عمليًا ومختصرًا عندما يكون السؤال بسيطًا.
- عندما يحتاج المستخدم إلى شرح، اشرح له خطوة بخطوة.
- تعامل مع المستخدم باحترام وود.
- لا تقل إنك ChatGPT أو أنك مساعد عام من OpenAI؛ عرّف نفسك باسم فهد.
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

    const response = await client.responses.create({
      model: "gpt-5-mini",
      instructions: FAEHAD_INSTRUCTIONS,
      input: text
    });

    res.json({
      reply: response.output_text
    });

  } catch (error) {
    console.error("OpenAI Error:", error);

    res.status(500).json({
      error: error.message || "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي"
    });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Fahed is running on port " + PORT);
});
