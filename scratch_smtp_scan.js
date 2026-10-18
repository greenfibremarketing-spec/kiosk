
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const encPath = path.join('C:/Users/ASUS/AppData/Roaming/GreenFibre Kiosk', 'prelaunch-smtp.enc');
  if (!fs.existsSync(encPath)) {
    console.log('SMTP_ENC_NOT_FOUND');
    app.exit(0);
  }
  const bytes = fs.readFileSync(encPath);
  const pass = safeStorage.decryptString(bytes);
  if (!pass || pass.length < 4) {
    console.log('SMTP_PASS_EMPTY');
    app.exit(0);
  }
  
  // scan winUnpacked
  function scan(dir, targetBuf) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (scan(full, targetBuf)) return true;
      } else if (e.isFile()) {
        const content = fs.readFileSync(full);
        if (content.includes(targetBuf)) return true;
      }
    }
    return false;
  }
  
  const found = scan('e:/greenfibre-kiosk/dist/win-unpacked', Buffer.from(pass));
  console.log(found ? 'SMTP_FOUND_LEAKED' : 'SMTP_NOT_FOUND_SAFE');
  app.exit(0);
});
