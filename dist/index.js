import 'dotenv/config';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import prism from 'prism-media';
import { createAudioPlayer, createAudioResource, joinVoiceChannel, entersState, VoiceConnectionStatus, AudioPlayerStatus, StreamType, NoSubscriberBehavior, } from '@discordjs/voice';
import { loadStations, findStation } from './radioList.js';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 150,
    },
});
let currentConnection = null;
const STATIONS_PER_PAGE = 20;
const STATIONS_PREV_ID = 'stations_prev';
const STATIONS_NEXT_ID = 'stations_next';
const STATIONS_PLAY_PREFIX = 'stations_play_';
function buildStationsPageContent(stations, page) {
    const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * STATIONS_PER_PAGE;
    const slice = stations.slice(start, start + STATIONS_PER_PAGE);
    const lines = slice.map((s, i) => `${start + i + 1}. **${s.name}** \`${s.hashtag ?? start + i + 1}\``);
    const content = [
        `📻 **Stations (page ${safePage}/${totalPages})**`,
        lines.join('\n'),
        '',
        'Use `!play <number>` or `!play <name/hashtag>` to play.',
    ].join('\n');
    return { content, totalPages };
}
function buildStationsPaginationRow(page, totalPages) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder()
        .setCustomId(STATIONS_PREV_ID)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1), new ButtonBuilder()
        .setCustomId(STATIONS_NEXT_ID)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages));
    return row;
}
const BUTTONS_PER_ROW = 5;
function buildStationsPlayRows(stations, page) {
    const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * STATIONS_PER_PAGE;
    const slice = stations.slice(start, start + STATIONS_PER_PAGE);
    const rows = [];
    for (let r = 0; r < slice.length; r += BUTTONS_PER_ROW) {
        const rowStations = slice.slice(r, r + BUTTONS_PER_ROW);
        const row = new ActionRowBuilder();
        for (let i = 0; i < rowStations.length; i++) {
            const globalIndex = start + r + i + 1;
            row.addComponents(new ButtonBuilder()
                .setCustomId(`${STATIONS_PLAY_PREFIX}${globalIndex}`)
                .setLabel(`▶ ${globalIndex}`)
                .setStyle(ButtonStyle.Success));
        }
        rows.push(row);
    }
    return rows;
}
function createStreamResource(streamUrl) {
    const ffmpeg = new prism.FFmpeg({
        args: [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-i', streamUrl,
            '-acodec', 'libopus',
            '-f', 'opus',
            '-ar', '48000',
            '-ac', '2',
        ],
    });
    return createAudioResource(ffmpeg, {
        inputType: StreamType.OggOpus,
        inlineVolume: false,
    });
}
function playStream(connection, station) {
    const resource = createStreamResource(station.stream_url);
    player.play(resource);
    connection.subscribe(player);
}
player.on('stateChange', (oldState, newState) => {
    if (oldState.status === AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Playing) {
        console.log('Playing radio stream');
    }
    if (newState.status === AudioPlayerStatus.Idle) {
        console.log('Stream stopped or error – will not auto-restart (use !play again if needed)');
    }
});
player.on('error', (err) => {
    console.error('AudioPlayer error:', err.message);
});
client.once('clientReady', async () => {
    if (!client.user)
        return;
    try {
        const stations = await loadStations();
        console.log(`Logged in as ${client.user.tag}`);
        console.log(`Loaded ${stations.length} stations from stations.txt`);
        console.log('Commands: !help | !stations [page] | !play [station name/number] | !stop');
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('Failed to load stations:', error.message);
        process.exit(1);
    }
});
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild)
        return;
    const content = message.content.trim();
    const lower = content.toLowerCase();
    const guild = message.guild;
    if (lower === '!help') {
        console.log(`[COMMAND] !help | Server: ${guild.name} (${guild.id}) | Channel: ${message.channel.name ?? message.channel.id} | User: ${message.author.tag}`);
        const helpText = [
            '**📻 Discord Radio Bot – Help**',
            '',
            '**!stations [page]**',
            'Lists all available radio stations (20 per page). Use the page number to jump, e.g. `!stations 2`. Use the Previous/Next buttons to browse pages.',
            '',
            '**!play** _number, name, or hashtag_',
            'Joins your current voice channel and plays the chosen station. You must be in a voice channel first. Examples: `!play 1`, `!play Radio Name`, `!play #hashtag`. Use `!stations` to see the full list and numbers.',
            '',
            '**!stop**',
            'Stops playback and leaves the voice channel.',
            '',
            '**!help**',
            'Shows this message.',
        ].join('\n');
        await message.reply(helpText);
        return;
    }
    if (lower === '!stations' || lower.startsWith('!stations ')) {
        try {
            const pageArg = content.slice('!stations'.length).trim();
            const page = pageArg ? Math.max(1, parseInt(pageArg, 10) || 1) : 1;
            console.log(`[COMMAND] !stations (page ${page}) | Server: ${guild.name} (${guild.id}) | Channel: ${message.channel.name ?? message.channel.id} | User: ${message.author.tag}`);
            const stations = await loadStations();
            const { content: text, totalPages } = buildStationsPageContent(stations, page);
            const safePage = Math.min(Math.max(1, page), totalPages);
            const playRows = buildStationsPlayRows(stations, safePage);
            const paginationRow = buildStationsPaginationRow(safePage, totalPages);
            const components = [...playRows, paginationRow];
            await message.reply({
                content: text,
                components,
            });
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await message.reply(`Could not load stations: ${error.message}`);
        }
        return;
    }
    if (lower === '!play' || lower.startsWith('!play ')) {
        const voiceChannel = message.member?.voice?.channel ?? null;
        const query = content.slice('!play'.length).trim();
        console.log(`[COMMAND] !play ${query || '(no args)'} | Server: ${guild.name} (${guild.id}) | User: ${message.author.tag}`);
        if (!voiceChannel) {
            await message.reply('Join a voice channel first, then use `!play`.');
            return;
        }
        try {
            const stations = await loadStations();
            const station = query ? findStation(stations, query) : undefined;
            if (query && !station) {
                await message.reply(`Station not found: \`${query}\`. Use \`!stations\` to list and \`!play <number or name>\` to play.`);
                return;
            }
            if (!station) {
                await message.reply('Usage: `!play <number>` or `!play <station name/hashtag>`. Use `!stations` to see the list.');
                return;
            }
            if (currentConnection) {
                currentConnection.destroy();
                currentConnection = null;
            }
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                daveEncryption: false,
            });
            currentConnection = connection;
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                console.error('Voice connection failed:', error.message);
                connection.destroy();
                currentConnection = null;
                await message.reply('Failed to join the voice channel. Try again.');
                return;
            }
            console.log(`[VOICE JOIN] Server: ${guild.name} (${guild.id}) | Channel: ${voiceChannel.name} (${voiceChannel.id}) | Station: ${station.name}`);
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                }
                catch {
                    connection.destroy();
                    currentConnection = null;
                }
            });
            playStream(connection, station);
            await message.reply(`Joining **${voiceChannel.name}** and playing **${station.name}**.`);
        }
        catch (err) {
            console.error(err);
            await message.reply('Something went wrong. Make sure FFmpeg is installed and stations are loaded.');
        }
        return;
    }
    if (lower === '!stop') {
        console.log(`[COMMAND] !stop | Server: ${guild.name} (${guild.id}) | User: ${message.author.tag}`);
        if (!currentConnection) {
            await message.reply('I am not in a voice channel.');
            return;
        }
        const joinConfig = currentConnection.joinConfig;
        const channelId = joinConfig.channelId ?? 'unknown';
        const guildId = joinConfig.guildId ?? 'unknown';
        console.log(`[VOICE LEAVE] Server ID: ${guildId} | Channel ID: ${channelId}`);
        player.stop();
        currentConnection.destroy();
        currentConnection = null;
        await message.reply('Stopped and left the voice channel.');
    }
});
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.guild)
        return;
    const { customId } = interaction;
    const guild = interaction.guild;
    if (customId.startsWith(STATIONS_PLAY_PREFIX)) {
        const indexStr = customId.slice(STATIONS_PLAY_PREFIX.length);
        const globalIndex = parseInt(indexStr, 10);
        if (!Number.isFinite(globalIndex) || globalIndex < 1)
            return;
        const userTag = interaction.user?.tag ?? 'unknown';
        console.log(`[COMMAND] Button: play station #${globalIndex} | Server: ${guild.name} (${guild.id}) | User: ${userTag}`);
        const voiceChannel = interaction.member && 'voice' in interaction.member
            ? interaction.member.voice?.channel ?? null
            : null;
        if (!voiceChannel) {
            await interaction.reply({
                content: 'Join a voice channel first, then click the play button.',
                ephemeral: true,
            });
            return;
        }
        await interaction.deferReply();
        try {
            const stations = await loadStations();
            if (globalIndex > stations.length) {
                await interaction.editReply(`Station #${globalIndex} is not available.`);
                return;
            }
            const station = stations[globalIndex - 1];
            if (currentConnection) {
                currentConnection.destroy();
                currentConnection = null;
            }
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                daveEncryption: false,
            });
            currentConnection = connection;
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                console.error('Voice connection failed:', error.message);
                connection.destroy();
                currentConnection = null;
                await interaction.editReply('Failed to join the voice channel. Try again.');
                return;
            }
            console.log(`[VOICE JOIN] Server: ${guild.name} (${guild.id}) | Channel: ${voiceChannel.name} (${voiceChannel.id}) | Station: ${station.name}`);
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                }
                catch {
                    connection.destroy();
                    currentConnection = null;
                }
            });
            playStream(connection, station);
            await interaction.editReply(`Joining **${voiceChannel.name}** and playing **${station.name}**.`);
        }
        catch (err) {
            console.error(err);
            await interaction.editReply('Something went wrong. Make sure FFmpeg is installed and stations are loaded.').catch(() => { });
        }
        return;
    }
    if (customId !== STATIONS_PREV_ID && customId !== STATIONS_NEXT_ID)
        return;
    const navLabel = customId === STATIONS_NEXT_ID ? 'next' : 'prev';
    console.log(`[COMMAND] Button: stations ${navLabel} | Server: ${guild.name} (${guild.id}) | User: ${interaction.user?.tag ?? 'unknown'}`);
    const msg = interaction.message;
    if (!msg.editable)
        return;
    const match = msg.content.match(/page\s+(\d+)\s*\/\s*(\d+)/i);
    if (!match)
        return;
    const currentPage = parseInt(match[1], 10);
    const totalPages = parseInt(match[2], 10);
    const nextPage = customId === STATIONS_NEXT_ID
        ? Math.min(currentPage + 1, totalPages)
        : Math.max(currentPage - 1, 1);
    await interaction.deferUpdate();
    try {
        const stations = await loadStations();
        const { content } = buildStationsPageContent(stations, nextPage);
        const playRows = buildStationsPlayRows(stations, nextPage);
        const paginationRow = buildStationsPaginationRow(nextPage, totalPages);
        await msg.edit({
            content,
            components: [...playRows, paginationRow],
        });
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await interaction.followUp({ content: `Could not load stations: ${error.message}`, ephemeral: true }).catch(() => { });
    }
});
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('Missing DISCORD_TOKEN. Set it in .env or environment.');
    process.exit(1);
}
client.login(token).catch((err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Login failed:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map