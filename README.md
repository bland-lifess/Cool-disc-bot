# 🎰 Slot Machine Discord Bot

A high-quality Discord bot featuring a slot machine game with weighted randomness, animated spinning effects, and a clean minimalist design.

## ✨ Features

- **Animated Spin Effect**: Uses custom animated emojis during the 3-second spin
- **Weighted Randomness**: Realistic slot machine odds (diamonds are rare, cherries are common)
- **Clean Embeds**: Minimalist design with lowercase text
- **Cooldown System**: 5-second per-user cooldown to prevent spam
- **Map-Based Economy**: In-memory balance tracking
- **Express Keep-Alive**: Server for Render deployment
- **Error Handling**: Graceful error handling to prevent crashes

## 🎮 Winning System

### Multipliers (3 Matches)
- 💎 Diamond: 50x (1% chance)
- 7️⃣ Seven: 10x (4% chance)
- 🔔 Bell: 5x (8% chance)
- 🍉 Watermelon: 3x (12% chance)
- 🍊 Orange: 2.5x (20% chance)
- 🍋 Lemon: 2x (25% chance)
- 🍒 Cherry: 1.5x (30% chance)

### 2 Matches
- Any two matching symbols: 0.5x (50% return)

## 🚀 Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd slot-machine-discord-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Your Bot

#### A. Create `.env` file
Copy `.env.example` to `.env` and add your Discord bot token:

```env
DISCORD_TOKEN=your_actual_bot_token_here
PORT=3000
```

#### B. Add Your Custom Emojis
Open `index.js` and find the `EMOJIS` configuration at the top (lines 7-21).

Replace the placeholder IDs with your actual emoji IDs:

```javascript
const EMOJIS = {
  animated: {
    spin: '<a:spin:1234567890>'  // Your animated spinning emoji
  },
  static: {
    cherry: '<:cherry:1234567890>',
    lemon: '<:lemon:1234567890>',
    orange: '<:orange:1234567890>',
    watermelon: '<:watermelon:1234567890>',
    bell: '<:bell:1234567890>',
    seven: '<:seven:1234567890>',
    diamond: '<:diamond:1234567890>'
  }
};
```

**How to get emoji IDs:**
1. Upload your emojis to your Discord server
2. Type `\:emoji_name:` in any channel
3. Copy the ID from the output (format: `<:name:ID>` or `<a:name:ID>` for animated)

### 4. Run Locally (Testing)

```bash
npm start
```

Your bot should now be online! Test with `.slots 100` in your Discord server.

## 🌐 Deploy to Render

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Create Render Web Service

1. Go to [render.com](https://render.com) and sign in
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `slot-machine-bot` (or your choice)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### 3. Add Environment Variables

In Render's dashboard, go to **Environment** and add:

- **Key**: `DISCORD_TOKEN`
- **Value**: Your bot token

Render automatically provides the `PORT` variable, so you don't need to add it.

### 4. Deploy

Click **Create Web Service**. Render will automatically deploy your bot!

## 📝 Usage

### Commands

`.slots [amount]` - Spin the slot machine with your bet amount

**Examples:**
- `.slots 50` - Bet 50 coins
- `.slots 100` - Bet 100 coins
- `.slots 500` - Bet 500 coins

### Default Settings

- **Starting Balance**: 1,000 coins (change `STARTING_BALANCE` in code)
- **Cooldown**: 5 seconds (change `COOLDOWN_TIME` in code)
- **Spin Duration**: 3 seconds (change `SPIN_DURATION` in code)

## 🛠️ Customization

### Adjust Weights

Edit the `SLOT_WEIGHTS` array in `index.js`:

```javascript
const SLOT_WEIGHTS = [
  { emoji: 'cherry', weight: 30, multiplier: 1.5 },
  { emoji: 'lemon', weight: 25, multiplier: 2 },
  // ... add or modify as needed
];
```

Higher `weight` = more common. Total weight doesn't need to equal 100.

### Change Spin Duration

Match your Alight Motion animation:

```javascript
const SPIN_DURATION = 3000; // 3 seconds (3000ms)
```

### Modify Cooldown

```javascript
const COOLDOWN_TIME = 5000; // 5 seconds (5000ms)
```

## 🔒 Required Bot Permissions

- `Send Messages`
- `Read Message History`
- `Use External Emojis`
- `Embed Links`

## ⚠️ Important Notes

- Balances are stored in memory and will reset when the bot restarts
- For persistent storage, integrate a database (MongoDB, PostgreSQL, etc.)
- The bot uses Message Content intent - make sure it's enabled in Discord Developer Portal

## 🐛 Troubleshooting

**Bot not responding:**
- Check that Message Content intent is enabled in Discord Developer Portal
- Verify your bot token is correct in `.env`
- Ensure bot has proper permissions in your server

**Emojis not showing:**
- Verify emoji IDs are correct in `index.js`
- Make sure bot has access to the server where emojis are uploaded
- Check that "Use External Emojis" permission is granted

**Deploy issues on Render:**
- Ensure `DISCORD_TOKEN` environment variable is set
- Check Render logs for specific error messages
- Verify your repository has all required files

## 📄 License

MIT License - feel free to use and modify!

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.
