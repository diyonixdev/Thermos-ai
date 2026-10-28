const fs = require('fs');
let s = fs.readFileSync('src/App.tsx', 'utf8');
const start = s.indexOf("        const fallback = `Current dashboard readings");
if (start >= 0) {
  const end = s.indexOf("        if (isRateLimit) {", start);
  const replacement = "        const errorMsg = isRateLimit\n          ? (language === 'hi' ? 'रेट लिमिट। कृपya पुनः प्रयास करें।' : 'Rate limited — please try again shortly.')\n          : (language === 'hi' ? 'मैं अभी उत्तर नहीं दे सकता। कृपya कुछ क्षण बाद पुनः प्रयास करें।' : 'I am temporarily unable to answer. Please try again shortly.')\n        setMessages((prev) => [...prev, { role: 'assistant', text: errorMsg, time: timeStr }])\n";
  s = s.slice(0, start) + replacement + s.slice(end);
  fs.writeFileSync('src/App.tsx', s);
  console.log('Fixed App.tsx fallback');
} else {
  console.log('Pattern not found in App.tsx');
}
