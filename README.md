# 🏙️ ObsidianCity3D — Backend

يحوّل Obsidian vault إلى بيانات JSON ثلاثية الأبعاد لمشروع Three.js.

## التثبيت السريع

```bash
cd obsidian-city-backend
npm install

# انسخ ملف البيئة وعدّل المسار
cp .env.example .env
nano .env  # عدّل VAULT_PATH ليشير لـ vault الحقيقي
```

## التشغيل

```bash
# تشغيل عادي
npm start

# تشغيل مع hot-reload (dev)
npm run dev

# اختبار الـ parser
npm test
```

## API Endpoints

| Endpoint                  | الوصف                                      |
| ------------------------- | ------------------------------------------ |
| `GET /api/health`         | فحص حالة الـ server                        |
| `GET /api/vault`          | بيانات vault الكاملة (مدن + مباني + روابط) |
| `GET /api/vault/stats`    | إحصائيات سريعة                             |
| `GET /api/vault/note/:id` | محتوى ملاحظة بعينها                        |

## صيغة الاستجابة `/api/vault`

```json
{
  "meta": {
    "vaultName": "MyVault",
    "totalCities": 3,
    "totalNotes": 42,
    "totalLinks": 87
  },
  "cities": [
    {
      "id": "المعلوماتية",
      "name": "المعلوماتية",
      "depth": 0,
      "position": { "x": -110, "z": 0, "y": 0 },
      "notes": [
        {
          "id": "react",
          "name": "React",
          "links": ["typescript", "node-js"],
          "linkCount": 2,
          "tags": ["frontend", "javascript"],
          "color": "#1a73e8",
          "height": 2
        }
      ],
      "subfolders": [ ... ]
    }
  ],
  "connections": [
    { "from": "react", "to": "typescript" },
    { "from": "react", "to": "node-js" }
  ]
}
```

## WebSocket Events

الـ server يبثّ أحداث تلقائياً عند تغيير الـ vault:

```json
{ "type": "vault:change",      "event": "change", "noteId": "react" }
{ "type": "vault:newFolder",   "path": "/path/to/folder" }
{ "type": "vault:removeFolder","path": "/path/to/folder" }
```

## قواعد التحويل

| عنصر Obsidian   | Three.js              |
| --------------- | --------------------- |
| مجلد رئيسي      | مدينة                 |
| مجلد فرعي       | حي / قرية             |
| ملاحظة `.md`    | مبنى                  |
| `[[wikilinks]]` | روابط / شوارع         |
| عدد الروابط     | ارتفاع المبنى (طوابق) |
| `#tags`         | لون / نوع المبنى      |
