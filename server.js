const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
