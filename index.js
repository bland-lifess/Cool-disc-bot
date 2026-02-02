const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');

// ─────────────────────────────────────────────
// CUSTOM EMOTES — do not modify
// ─────────────────────────────────────────────
const EMOTES = {
    ROLLING: '<a:rolling:1467751477211562035>',
    CHERRY: '<:cherryslot:1467753520974270605>',
    LEMON: '<:lemonslot:1467753414648795320>',
    MONEY: '<:moneyslot:1467753282041811025>',
    DIAMOND: '<:diamondslot:1467753600745734466>',
    CROWN: '<:crownslot:1467753347728674909>'
};

// ─────────────────────────────────────────────
// SLOT CONFIGURATION
// Each entry: { key, weight, multiplier3x, multiplier2x }
//   weight        → used for weighted random draw
//   multiplier3x  → payout for three-of-a-kind
//   multiplier2x  → payout for a pair
// ─────────────────────────────────────────────
const SLOTS = [
    { key: 'CHERRY',  weight: 20, multiplier3x: 2,   multiplier2x: 0.4 },  // common   (40% shared)
    { key: 'LEMON',   weight: 20, multiplier3x: 2.5, multiplier2x: 0.4 },  // common   (40% shared)
    { key: 'MONEY',   weight: 30, multiplier3x: 4,   multiplier2x: 0.6 },  // uncommon (30%)
    { key: 'DIAMOND', weight: 20, multiplier3x: 8,   multiplier2x: 1.0 },  // rare     (20%)
    { key: 'CROWN',   weight: 10, multiplier3x: 20,  multiplier2x: 1.5 }   // jackpot  (10%)
];

// Pre-compute the cumulative weight table once at startup for fast lookups.
const WEIGHT_TABLE = (() => {
    let cumulative = 0;
    return SLOTS.map(slot => {
        cumulative += slot.weight;
        return { ...slot, cumulative };
    });
})();
const TOTAL_WEIGHT = WEIGHT_TABLE[WEIGHT_TABLE.length - 1].cumulative; // 100

// ─────────────────────────────────────────────
// ECONOMY & COOLDOWN STATE
// ─────────────────────────────────────────────
const balances  = new Map();          // userId  → number (coins)
const cooldowns = new Map();          // userId  → number (timestamp ms)
const STARTING_BALANCE = 1000;
const COOLDOWN_MS      = 5000;        // 5 seconds
const SPIN_DELAY_MS    = 3000;        // 3 seconds (matches your animation)

// ─────────────────────────────────────────────
// EXPRESS KEEP-ALIVE SERVER
// ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => res.send('slot bot is alive'));

app.listen(PORT, () => console.log(`[keep-alive] listening on port ${PORT}`));

// ─────────────────────────────────────────────
// DISCORD CLIENT
// ─────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`[discord] logged in as ${client.user.tag}`);
    client.user.setActivity('.slots [amount]');
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Pull one symbol using the cumulative-weight table. */
function spinOnce() {
    const roll = Math.random() * TOTAL_WEIGHT;
    for (const slot of WEIGHT_TABLE) {
        if (roll < slot.cumulative) return slot;
    }
    return WEIGHT_TABLE[WEIGHT_TABLE.length - 1]; // safety fallback
}

/** Return the current balance, seeding the Map if this is a first-time user. */
function getBalance(userId) {
    if (!balances.has(userId)) balances.set(userId, STARTING_BALANCE);
    return balances.get(userId);
}

/** Remaining cooldown in ms, or 0 if none. */
function getCooldownLeft(userId) {
    const last = cooldowns.get(userId);
    if (!last) return 0;
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? remaining : 0;
}

// ─────────────────────────────────────────────
// COMMAND — .slots [amount]
// ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('.slots')) return;

    // ── parse & validate ──────────────────────
    const raw = message.content.split(/\s+/)[1]; // everything after ".slots"

    if (!raw) {
        return message.reply('please provide a bet amount: `.slots <amount>`').catch(() => {});
    }

    const amount = Number(raw);

    if (!Number.isInteger(amount) || amount <= 0) {
        return message.reply('bet must be a positive whole number').catch(() => {});
    }

    const userId  = message.author.id;
    const balance  = getBalance(userId);

    if (amount > balance) {
        return message.reply(`not enough coins. your balance: **${balance}**`).catch(() => {});
    }

    // ── cooldown check ────────────────────────
    const cooldownLeft = getCooldownLeft(userId);
    if (cooldownLeft > 0) {
        const secs = (cooldownLeft / 1000).toFixed(1);
        return message.reply(`on cooldown. try again in **${secs}s**`).catch(() => {});
    }

    // ── lock in the bet & set cooldown ────────
    balances.set(userId, balance - amount);
    cooldowns.set(userId, Date.now());

    // ── send the spinning animation ───────────
    let spinMsg;
    try {
        spinMsg = await message.channel.send(
            `${EMOTES.ROLLING} ${EMOTES.ROLLING} ${EMOTES.ROLLING}`
        );
    } catch (err) {
        console.error('[slots] failed to send spin message:', err);
        balances.set(userId, balance); // refund
        return message.reply('something went wrong — bet has been refunded').catch(() => {});
    }

    // ── generate the result now, reveal after the delay ──
    const reels = [spinOnce(), spinOnce(), spinOnce()];

    // ── calculate payout ──────────────────────
    let payout = 0;

    if (reels[0].key === reels[1].key && reels[1].key === reels[2].key) {
        // 3-of-a-kind
        payout = Math.floor(amount * reels[0].multiplier3x);
    } else if (reels[0].key === reels[1].key || reels[1].key === reels[2].key || reels[0].key === reels[2].key) {
        // pair — use the multiplier of whichever symbol is doubled
        const paired =
            reels[0].key === reels[1].key ? reels[0] :
            reels[1].key === reels[2].key ? reels[1] :
                                            reels[0];
        payout = Math.floor(amount * paired.multiplier2x);
    }

    const isWin      = payout > 0;
    const newBalance = getBalance(userId) + payout;
    balances.set(userId, newBalance);

    // ── wait for the animation to finish ──────
    setTimeout(async () => {
        const resultLine = reels.map(r => EMOTES[r.key]).join(' ');

        // ── build embed ─────────────────────────
        const embed = new EmbedBuilder()
            .setColor(isWin ? 0x57F287 : 0xED4337)   // discord green / red
            .setTitle(isWin ? '🏆 you won!' : '💸 you lost')
            .setDescription(
                isWin
                    ? `you won **${payout}** coins`
                    : `you lost **${amount}** coins`
            )
            .addFields(
                { name: 'bet',         value: `${amount}`,     inline: true },
                { name: 'payout',      value: `${payout}`,     inline: true },
                { name: 'new balance', value: `${newBalance}`, inline: true }
            )
            .setFooter({ text: message.author.username })
            .setTimestamp();

        // ── edit the spinning message ───────────
        try {
            await spinMsg.edit({ content: resultLine, embeds: [embed] });
        } catch (err) {
            console.error('[slots] failed to edit spin message:', err);
            // fallback: send a new message if the edit fails (e.g. message deleted)
            message.channel.send({ content: `${message.author} ${resultLine}`, embeds: [embed] }).catch(() => {});
        }
    }, SPIN_DELAY_MS);
});

// ─────────────────────────────────────────────
// GLOBAL ERROR SAFETY NET
// ─────────────────────────────────────────────
client.on('error', (err) => console.error('[discord error]', err));

process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err));

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('[login] failed:', err.message);
    process.exit(1);
});
