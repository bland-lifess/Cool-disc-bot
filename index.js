const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
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
const balances    = new Map();          // userId  → number (coins)
const cooldowns   = new Map();          // userId  → number (timestamp ms)
const dailyClaims = new Map();          // userId  → string (UTC date key "YYYY-MM-DD")
const ADMIN_ID    = '1226216676354297952';
const STARTING_BALANCE = 1000;
const COOLDOWN_MS      = 5000;          // 5 seconds
const SPIN_DELAY_MS    = 3000;          // 3 seconds (matches your animation)
const DAILY_AMOUNT     = 50;

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

client.once('ready', async () => {
    console.log(`[discord] logged in as ${client.user.tag}`);
    client.user.setActivity('.slots [amount]');

    // register slash commands with Discord
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        // push to every guild the bot is in
        for (const [guildId] of client.guilds.cache) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands.map(c => c.toJSON()) }
            );
        }
        console.log('[slash] commands registered');
    } catch (err) {
        console.error('[slash] registration failed:', err);
    }
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

/** Current UTC date as "YYYY-MM-DD" — used as the daily-claim key. */
function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// SLASH COMMAND DEFINITIONS
// ─────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('slots')
        .setDescription('spin the slot machine')
        .addIntegerOption(opt =>
            opt.setName('amount')
               .setDescription('how many coins to bet')
               .setRequired(true)
               .setMinValue(1)
        ),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('claim your daily coins'),
    new SlashCommandBuilder()
        .setName('addcoins')
        .setDescription('(admin) add coins to a user')
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription('who to give coins to')
               .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('amount')
               .setDescription('how many coins to add')
               .setRequired(true)
               .setMinValue(1)
        )
];

// ─────────────────────────────────────────────
// SHARED COMMAND LOGIC (prefix + slash call these)
// ─────────────────────────────────────────────

/**
 * Runs the full slots flow.
 * `sendFn(text)`   → sends the initial spinning message, must return the message object
 * `replyFn(text)`  → sends a one-off reply (validation errors, etc.)
 * `userId`        → the betting user's ID
 */
async function handleSlots(userId, amount, sendFn, replyFn) {
    // ── validate ──────────────────────────────
    const balance = getBalance(userId);

    if (amount > balance) {
        return replyFn(`not enough coins. your balance: **${balance}**`);
    }

    const cooldownLeft = getCooldownLeft(userId);
    if (cooldownLeft > 0) {
        const secs = (cooldownLeft / 1000).toFixed(1);
        return replyFn(`on cooldown. try again in **${secs}s**`);
    }

    // ── lock bet & cooldown ───────────────────
    balances.set(userId, balance - amount);
    cooldowns.set(userId, Date.now());

    // ── send spinning animation ───────────────
    let spinMsg;
    try {
        spinMsg = await sendFn(`${EMOTES.ROLLING} ${EMOTES.ROLLING} ${EMOTES.ROLLING}`);
    } catch (err) {
        console.error('[slots] failed to send spin message:', err);
        balances.set(userId, balance); // refund
        return replyFn('something went wrong — bet has been refunded');
    }

    // ── roll & calculate ──────────────────────
    const reels  = [spinOnce(), spinOnce(), spinOnce()];
    let   payout = 0;

    if (reels[0].key === reels[1].key && reels[1].key === reels[2].key) {
        payout = Math.floor(amount * reels[0].multiplier3x);
    } else if (reels[0].key === reels[1].key || reels[1].key === reels[2].key || reels[0].key === reels[2].key) {
        const paired =
            reels[0].key === reels[1].key ? reels[0] :
            reels[1].key === reels[2].key ? reels[1] :
                                            reels[0];
        payout = Math.floor(amount * paired.multiplier2x);
    }

    const isWin      = payout > 0;
    const newBalance = getBalance(userId) + payout;
    balances.set(userId, newBalance);

    // ── reveal after animation ────────────────
    setTimeout(async () => {
        const reelLine = reels.map(r => EMOTES[r.key]).join(' ');

        const resultText = isWin
            ? `${reelLine}\n\n✨ **won ${payout} coins**  ·  balance: ${newBalance}`
            : `${reelLine}\n\n💔 **lost ${amount} coins**  ·  balance: ${newBalance}`;

        try {
            await spinMsg.edit(resultText);
        } catch (err) {
            console.error('[slots] failed to edit spin message:', err);
            replyFn(resultText).catch(() => {});
        }
    }, SPIN_DELAY_MS);
}

/**
 * Runs the daily claim.
 * Returns the reply string (caller sends it).
 */
function handleDaily(userId) {
    const today     = todayUTC();
    const lastClaim = dailyClaims.get(userId);

    if (lastClaim === today) {
        // calculate how long until midnight UTC
        const now      = new Date();
        const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        const msLeft   = midnight - now;
        const hh = String(Math.floor(msLeft / 3600000)).padStart(2, '0');
        const mm = String(Math.floor((msLeft % 3600000) / 60000)).padStart(2, '0');
        const ss = String(Math.floor((msLeft % 60000) / 1000)).padStart(2, '0');
        return `already claimed today. resets in **${hh}:${mm}:${ss}**`;
    }

    dailyClaims.set(userId, today);
    const bal = getBalance(userId) + DAILY_AMOUNT;
    balances.set(userId, bal);
    return `🎁 **+${DAILY_AMOUNT} coins** claimed  ·  balance: ${bal}`;
}

/**
 * Runs the addcoins admin command.
 * Returns the reply string (caller sends it).
 */
function handleAddCoins(invokerId, targetId, amount) {
    if (invokerId !== ADMIN_ID) {
        return '🚫 you don\'t have permission to use this command';
    }
    const bal = getBalance(targetId) + amount;
    balances.set(targetId, bal);
    return `✅ **+${amount} coins** added to <@${targetId}>  ·  their balance: ${bal}`;
}

// ─────────────────────────────────────────────
// PREFIX COMMANDS  (.slots / .daily / .addcoins)
// ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const parts = message.content.split(/\s+/);
    const cmd   = parts[0].toLowerCase();

    // ── .slots ──────────────────────────────────
    if (cmd === '.slots') {
        const raw = parts[1];
        if (!raw) {
            return message.reply('please provide a bet amount: `.slots <amount>`').catch(() => {});
        }
        const amount = Number(raw);
        if (!Number.isInteger(amount) || amount <= 0) {
            return message.reply('bet must be a positive whole number').catch(() => {});
        }

        return handleSlots(
            message.author.id,
            amount,
            (text) => message.channel.send(text),   // sendFn
            (text) => message.reply(text)            // replyFn
        );
    }

    // ── .daily ──────────────────────────────────
    if (cmd === '.daily') {
        return message.reply(handleDaily(message.author.id)).catch(() => {});
    }

    // ── .addcoins @user <amount> ────────────────
    if (cmd === '.addcoins') {
        const target = message.mentions.users.first();
        const amount = Number(parts[2]);

        if (!target || !Number.isInteger(amount) || amount <= 0) {
            return message.reply('usage: `.addcoins @user <amount>`').catch(() => {});
        }

        return message.reply(handleAddCoins(message.author.id, target.id, amount)).catch(() => {});
    }
});

// ─────────────────────────────────────────────
// SLASH COMMANDS  (/slots / /daily / /addcoins)
// ─────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // ── /slots ──────────────────────────────────
    if (interaction.commandName === 'slots') {
        const amount = interaction.options.getInteger('amount');
        const userId = interaction.user.id;

        // ── validate before replying (avoids a flash of the spin animation on error) ──
        const balance = getBalance(userId);
        if (amount > balance) {
            return interaction.reply(`not enough coins. your balance: **${balance}**`).catch(() => {});
        }

        const cooldownLeft = getCooldownLeft(userId);
        if (cooldownLeft > 0) {
            const secs = (cooldownLeft / 1000).toFixed(1);
            return interaction.reply(`on cooldown. try again in **${secs}s**`).catch(() => {});
        }

        // ── lock bet & cooldown ───────────────────
        balances.set(userId, balance - amount);
        cooldowns.set(userId, Date.now());

        // ── send the spin animation as the initial reply ──
        await interaction.reply(`${EMOTES.ROLLING} ${EMOTES.ROLLING} ${EMOTES.ROLLING}`).catch(() => {});

        const spinMsg = await interaction.fetchReply().catch(() => null);
        if (!spinMsg) {
            balances.set(userId, balance); // refund if we can't get the message
            return;
        }

        // ── roll & calculate ──────────────────────
        const reels  = [spinOnce(), spinOnce(), spinOnce()];
        let   payout = 0;

        if (reels[0].key === reels[1].key && reels[1].key === reels[2].key) {
            payout = Math.floor(amount * reels[0].multiplier3x);
        } else if (reels[0].key === reels[1].key || reels[1].key === reels[2].key || reels[0].key === reels[2].key) {
            const paired =
                reels[0].key === reels[1].key ? reels[0] :
                reels[1].key === reels[2].key ? reels[1] :
                                                reels[0];
            payout = Math.floor(amount * paired.multiplier2x);
        }

        const isWin      = payout > 0;
        const newBalance = getBalance(userId) + payout;
        balances.set(userId, newBalance);

        // ── reveal after animation ────────────────
        setTimeout(async () => {
            const reelLine   = reels.map(r => EMOTES[r.key]).join(' ');
            const resultText = isWin
                ? `${reelLine}\n\n✨ **won ${payout} coins**  ·  balance: ${newBalance}`
                : `${reelLine}\n\n💔 **lost ${amount} coins**  ·  balance: ${newBalance}`;

            await spinMsg.edit(resultText).catch(() => {});
        }, SPIN_DELAY_MS);

        return;
    }

    // ── /daily ──────────────────────────────────
    if (interaction.commandName === 'daily') {
        return interaction.reply(handleDaily(interaction.user.id)).catch(() => {});
    }

    // ── /addcoins ───────────────────────────────
    if (interaction.commandName === 'addcoins') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return interaction.reply(handleAddCoins(interaction.user.id, target.id, amount)).catch(() => {});
    }
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
