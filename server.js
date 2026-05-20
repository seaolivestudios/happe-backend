if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const emailTransporter = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

async function sendEmail(to, subject, html) {
  if (emailTransporter) {
    await emailTransporter.sendMail({ from: `Happ-E <${process.env.EMAIL_USER}>`, to, subject, html });
  } else {
    console.log(`[EMAIL - no transport configured] To: ${to} | ${subject} | ${html}`);
  }
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

fastify.register(cors, { origin: true, credentials: true });
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'happe-secret-key',
});

async function sendPush(pushToken, title, body, data = {}) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: 'default' }),
    });
  } catch (err) {
    console.error('Push send error:', err.message);
  }
}

fastify.get('/', async () => ({
  status: 'ok',
  message: 'Happ-E API is running',
  version: '1.1.0'
}));

// --- Shop items catalogue ---

const FRAME_TEAMS = {
  NFL: [
    {slug:'buffalo',      name:'Bills',       c:['#00338D','#C60C30','#FFFFFF'], div:'AFC East'},
    {slug:'miami',        name:'Dolphins',    c:['#008E97','#FC4C02','#FFFFFF'], div:'AFC East'},
    {slug:'newengland',   name:'Patriots',    c:['#002244','#C60C30','#B0B7BC'], div:'AFC East'},
    {slug:'nyj',          name:'Jets',        c:['#125740','#000000','#FFFFFF'], div:'AFC East'},
    {slug:'baltimore',    name:'Ravens',      c:['#241773','#000000','#9E7C0C'], div:'AFC North'},
    {slug:'cincinnati',   name:'Bengals',     c:['#FB4F14','#000000','#FFFFFF'], div:'AFC North'},
    {slug:'cleveland',    name:'Browns',      c:['#311D00','#FF3C00','#FFFFFF'], div:'AFC North'},
    {slug:'pittsburgh',   name:'Steelers',    c:['#101820','#FFB612','#C60C30'], div:'AFC North'},
    {slug:'houston',      name:'Texans',      c:['#03202F','#A71930','#FFFFFF'], div:'AFC South'},
    {slug:'indianapolis', name:'Colts',       c:['#002C5F','#A2AAAD','#FFFFFF'], div:'AFC South'},
    {slug:'jacksonville', name:'Jaguars',     c:['#101820','#D7A22A','#006778'], div:'AFC South'},
    {slug:'tennessee',    name:'Titans',      c:['#0C2340','#4B92DB','#C8102E'], div:'AFC South'},
    {slug:'denver',       name:'Broncos',     c:['#FB4F14','#002244','#FFFFFF'], div:'AFC West'},
    {slug:'kansascity',   name:'Chiefs',      c:['#E31837','#FFB81C','#FFFFFF'], div:'AFC West'},
    {slug:'lasvegas',     name:'Raiders',     c:['#000000','#A5ACAF','#FFFFFF'], div:'AFC West'},
    {slug:'lachargers',   name:'Chargers',    c:['#002A5E','#FFC20E','#FFFFFF'], div:'AFC West'},
    {slug:'dallas',       name:'Cowboys',     c:['#003594','#041E42','#869397'], div:'NFC East'},
    {slug:'nygiants',     name:'Giants',      c:['#0B2265','#A71930','#FFFFFF'], div:'NFC East'},
    {slug:'philadelphia', name:'Eagles',      c:['#004C54','#A5ACAF','#ACC0C6'], div:'NFC East'},
    {slug:'washington',   name:'Commanders',  c:['#5A1414','#FFB612','#FFFFFF'], div:'NFC East'},
    {slug:'chicago',      name:'Bears',       c:['#0B162A','#C83803','#FFFFFF'], div:'NFC North'},
    {slug:'detroit',      name:'Lions',       c:['#0076B6','#B0B7BC','#FFFFFF'], div:'NFC North'},
    {slug:'greenbay',     name:'Packers',     c:['#203731','#FFB612','#FFFFFF'], div:'NFC North'},
    {slug:'minnesota',    name:'Vikings',     c:['#4F2683','#FFC62F','#FFFFFF'], div:'NFC North'},
    {slug:'atlanta',      name:'Falcons',     c:['#A71930','#000000','#A5ACAF'], div:'NFC South'},
    {slug:'carolina',     name:'Panthers',    c:['#0085CA','#101820','#BFC0BF'], div:'NFC South'},
    {slug:'neworleans',   name:'Saints',      c:['#D3BC8D','#101820','#FFFFFF'], div:'NFC South'},
    {slug:'tampabay',     name:'Buccaneers',  c:['#D50A0A','#FF7900','#0A0A08'], div:'NFC South'},
    {slug:'arizona',      name:'Cardinals',   c:['#97233F','#000000','#FFB612'], div:'NFC West'},
    {slug:'larams',       name:'Rams',        c:['#003594','#FFA300','#FFFFFF'], div:'NFC West'},
    {slug:'sanfrancisco', name:'49ers',       c:['#AA0000','#B3995D','#FFFFFF'], div:'NFC West'},
    {slug:'seattle',      name:'Seahawks',    c:['#002244','#69BE28','#A5ACAF'], div:'NFC West'},
  ],
  NBA: [
    {slug:'atlanta',      name:'Hawks',           c:['#E03A3E','#C1D32F','#FFFFFF']},
    {slug:'boston',       name:'Celtics',         c:['#007A33','#BA9653','#FFFFFF']},
    {slug:'brooklyn',     name:'Nets',            c:['#000000','#FFFFFF','#777777']},
    {slug:'charlotte',    name:'Hornets',         c:['#1D1160','#00788C','#A1A1A4']},
    {slug:'chicago',      name:'Bulls',           c:['#CE1141','#000000','#FFFFFF']},
    {slug:'cleveland',    name:'Cavaliers',       c:['#6F263D','#FFB81C','#FFFFFF']},
    {slug:'dallas',       name:'Mavericks',       c:['#00538C','#002B5E','#B8C4CA']},
    {slug:'denver',       name:'Nuggets',         c:['#0E2240','#FEC524','#8B2131']},
    {slug:'detroit',      name:'Pistons',         c:['#C8102E','#006BB6','#BEC0C2']},
    {slug:'goldenstate',  name:'Warriors',        c:['#1D428A','#FFC72C','#FFFFFF']},
    {slug:'houston',      name:'Rockets',         c:['#CE1141','#000000','#C4CED4']},
    {slug:'indiana',      name:'Pacers',          c:['#002D62','#FDBB30','#BEC0C2']},
    {slug:'laclippers',   name:'Clippers',        c:['#C8102E','#1D428A','#BEC0C2']},
    {slug:'lalakers',     name:'Lakers',          c:['#552583','#FDB927','#FFFFFF']},
    {slug:'memphis',      name:'Grizzlies',       c:['#5D76A9','#12173F','#F5B112']},
    {slug:'miami',        name:'Heat',            c:['#98002E','#F9A01B','#000000']},
    {slug:'milwaukee',    name:'Bucks',           c:['#00471B','#EEE1C6','#0077C0']},
    {slug:'minnesota',    name:'Timberwolves',    c:['#0C2340','#236192','#78BE20']},
    {slug:'neworleans',   name:'Pelicans',        c:['#0C2340','#C8102E','#85714D']},
    {slug:'nyknicks',     name:'Knicks',          c:['#006BB6','#F58426','#BEC0C2']},
    {slug:'okc',          name:'Thunder',         c:['#007AC1','#EF3B24','#002D62']},
    {slug:'orlando',      name:'Magic',           c:['#0077C0','#C4CED4','#000000']},
    {slug:'philadelphia', name:'76ers',           c:['#006BB6','#ED174C','#002B5C']},
    {slug:'phoenix',      name:'Suns',            c:['#1D1160','#E56020','#000000']},
    {slug:'portland',     name:'Trail Blazers',   c:['#E03A3E','#000000','#FFFFFF']},
    {slug:'sacramento',   name:'Kings',           c:['#5A2D81','#63727A','#FFFFFF']},
    {slug:'sanantonio',   name:'Spurs',           c:['#C4CED4','#000000','#FFFFFF']},
    {slug:'toronto',      name:'Raptors',         c:['#CE1141','#000000','#A1A1A4']},
    {slug:'utah',         name:'Jazz',            c:['#002B5C','#00471B','#F9A01B']},
    {slug:'washington',   name:'Wizards',         c:['#002B5C','#E31837','#C4CED4']},
  ],
  MLB: [
    {slug:'arizona',      name:'Diamondbacks',    c:['#A71930','#E3D4AD','#000000']},
    {slug:'atlanta',      name:'Braves',          c:['#CE1141','#13274F','#FFFFFF']},
    {slug:'baltimore',    name:'Orioles',         c:['#DF4601','#000000','#FFFFFF']},
    {slug:'boston',       name:'Red Sox',         c:['#BD3039','#0D2B56','#FFFFFF']},
    {slug:'chicagocubs',  name:'Cubs',            c:['#0E3386','#CC3433','#FFFFFF']},
    {slug:'chicagowsox',  name:'White Sox',       c:['#27251F','#C4CED4','#FFFFFF']},
    {slug:'cincinnati',   name:'Reds',            c:['#C6011F','#000000','#FFFFFF']},
    {slug:'cleveland',    name:'Guardians',       c:['#00385D','#E31937','#FFFFFF']},
    {slug:'colorado',     name:'Rockies',         c:['#333366','#C4CED4','#000000']},
    {slug:'detroit',      name:'Tigers',          c:['#0C2C56','#FA4616','#FFFFFF']},
    {slug:'houston',      name:'Astros',          c:['#002D62','#EB6E1F','#FFFFFF']},
    {slug:'kansascity',   name:'Royals',          c:['#004687','#BD9B60','#FFFFFF']},
    {slug:'laangels',     name:'Angels',          c:['#BA0021','#003263','#C4CED4']},
    {slug:'ladodgers',    name:'Dodgers',         c:['#005A9C','#EF3E42','#FFFFFF']},
    {slug:'miami',        name:'Marlins',         c:['#00A3E0','#EF3340','#000000']},
    {slug:'milwaukee',    name:'Brewers',         c:['#FFC52F','#12284B','#FFFFFF']},
    {slug:'minnesota',    name:'Twins',           c:['#002B5C','#D31145','#CFAB7A']},
    {slug:'nymets',       name:'Mets',            c:['#002D72','#FF5910','#FFFFFF']},
    {slug:'nyyankees',    name:'Yankees',         c:['#132448','#C4CED4','#FFFFFF']},
    {slug:'oakland',      name:'Athletics',       c:['#003831','#EFB21E','#A2AAAD']},
    {slug:'philadelphia', name:'Phillies',        c:['#E81828','#002D72','#FFFFFF']},
    {slug:'pittsburgh',   name:'Pirates',         c:['#FDB827','#27251F','#FFFFFF']},
    {slug:'sandiego',     name:'Padres',          c:['#2F241D','#FFC425','#A0AAB2']},
    {slug:'sanfrancisco', name:'Giants',          c:['#FD5A1E','#27251F','#EFD19F']},
    {slug:'seattle',      name:'Mariners',        c:['#0C2C56','#005C5C','#C4CED4']},
    {slug:'stlouis',      name:'Cardinals',       c:['#C41E3A','#0C2340','#FEDB00']},
    {slug:'tampabay',     name:'Rays',            c:['#092C5C','#8FBCE6','#F5D130']},
    {slug:'texas',        name:'Rangers',         c:['#003278','#C0111F','#FFFFFF']},
    {slug:'toronto',      name:'Blue Jays',       c:['#134A8E','#1D2D5C','#E8291C']},
    {slug:'washington',   name:'Nationals',       c:['#AB0003','#14225A','#FFFFFF']},
  ],
  NHL: [
    {slug:'anaheim',      name:'Ducks',           c:['#F47A38','#B9975B','#000000']},
    {slug:'boston',       name:'Bruins',          c:['#FCB514','#000000','#FFFFFF']},
    {slug:'buffalo',      name:'Sabres',          c:['#003087','#FFB81C','#FFFFFF']},
    {slug:'calgary',      name:'Flames',          c:['#C8102E','#F1BE48','#000000']},
    {slug:'carolina',     name:'Hurricanes',      c:['#CC0000','#000000','#A2AAAD']},
    {slug:'chicago',      name:'Blackhawks',      c:['#CF0A2C','#000000','#FF671B']},
    {slug:'colorado',     name:'Avalanche',       c:['#6F263D','#236192','#A2AAAD']},
    {slug:'columbus',     name:'Blue Jackets',    c:['#002654','#CE1126','#A2AAAD']},
    {slug:'dallas',       name:'Stars',           c:['#006847','#8F8F8C','#000000']},
    {slug:'detroit',      name:'Red Wings',       c:['#CE1126','#FFFFFF','#000000']},
    {slug:'edmonton',     name:'Oilers',          c:['#041E42','#FC4C02','#FFFFFF']},
    {slug:'florida',      name:'Panthers',        c:['#041E42','#C8102E','#B9975B']},
    {slug:'losangeles',   name:'Kings',           c:['#111111','#A2AAAD','#FFFFFF']},
    {slug:'minnesota',    name:'Wild',            c:['#154734','#DDAF48','#BF2B37']},
    {slug:'montreal',     name:'Canadiens',       c:['#AF1E2D','#192168','#FFFFFF']},
    {slug:'nashville',    name:'Predators',       c:['#FFB81C','#041E42','#FFFFFF']},
    {slug:'newjersey',    name:'Devils',          c:['#CE1126','#000000','#FFFFFF']},
    {slug:'nyislanders',  name:'Islanders',       c:['#003087','#FC4C02','#FFFFFF']},
    {slug:'nyrangers',    name:'Rangers',         c:['#0038A8','#CE1126','#FFFFFF']},
    {slug:'ottawa',       name:'Senators',        c:['#C52032','#C69214','#000000']},
    {slug:'philadelphia', name:'Flyers',          c:['#F74902','#000000','#FFFFFF']},
    {slug:'pittsburgh',   name:'Penguins',        c:['#000000','#CFC493','#FCB514']},
    {slug:'sanjose',      name:'Sharks',          c:['#006D75','#EA7200','#000000']},
    {slug:'seattle',      name:'Kraken',          c:['#001628','#99D9D9','#68A2B9']},
    {slug:'stlouis',      name:'Blues',           c:['#002F87','#FCB514','#FFFFFF']},
    {slug:'tampabay',     name:'Lightning',       c:['#002868','#FFFFFF','#000000']},
    {slug:'toronto',      name:'Maple Leafs',     c:['#00205B','#FFFFFF','#A2AAAD']},
    {slug:'utah',         name:'Hockey Club',     c:['#6CACE4','#010101','#FFFFFF']},
    {slug:'vancouver',    name:'Canucks',         c:['#00205B','#00843D','#FFFFFF']},
    {slug:'vegas',        name:'Golden Knights',  c:['#B4975A','#333F42','#000000']},
    {slug:'washington',   name:'Capitals',        c:['#041E42','#C8102E','#FFFFFF']},
    {slug:'winnipeg',     name:'Jets',            c:['#041E42','#004C97','#FFFFFF']},
  ],
};

// Generate 248 frame items (2 styles × 124 teams)
const FRAME_ITEMS = [];
for (const [league, teams] of Object.entries(FRAME_TEAMS)) {
  for (const team of teams) {
    const leagueLower = league.toLowerCase();
    const prefix = `frame_${leagueLower}_${team.slug}`;
    const divLabel = team.div ? ` · ${team.div}` : '';
    FRAME_ITEMS.push(
      { id: `${prefix}_split`,    name: `${team.name} Split`,    description: `${league}${divLabel}`, price: 100, category: 'frame', league, teamSlug: team.slug, style: 'split',    colors: team.c },
      { id: `${prefix}_gradient`, name: `${team.name} Gradient`, description: `${league}${divLabel}`, price: 100, category: 'frame', league, teamSlug: team.slug, style: 'gradient', colors: team.c }
    );
  }
}

const BADGE_ITEMS = [
  // Movie Quotes
  { id: 'badge_movie_ill_be_back',       name: "I'll be back",                  price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_looking_at_you',    name: "Here's looking at you, kid",    price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_may_the_force',     name: "May the Force be with you",     price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_handle_truth',      name: "You can't handle the truth!",   price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_i_see_dead',        name: "I see dead people",             price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_no_place_home',     name: "There's no place like home",    price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_houston_problem',   name: "Houston, we have a problem",    price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_box_chocolates',    name: "Life is like a box of chocolates", price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_just_keep_swimming',name: "Just keep swimming",            price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_to_infinity',       name: "To infinity and beyond!",       price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_why_so_serious',    name: "Why so serious?",               price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_you_had_me',        name: "You had me at hello",           price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_king_of_world',     name: "I'm the king of the world!",    price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_get_to_choppa',     name: "Get to the choppa!",            price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_i_am_groot',        name: "I am Groot",                    price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_this_is_sparta',    name: "This is Sparta!",               price: 75, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_you_is_kind',       name: "You is kind, you is smart",     price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_one_more_thing',    name: "Just one more thing...",        price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_hakuna_matata',     name: "Hakuna matata",                 price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_bigger_boat',       name: "We need a bigger boat",         price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_kind_of_big_deal',  name: "I'm kind of a big deal",        price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_inconceivable',     name: "Inconceivable!",                price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_elementary',        name: "Elementary, my dear Watson",    price: 50, category: 'badge', genre: 'movie' },
  { id: 'badge_movie_with_great_power',  name: "With great power...",           price: 50, category: 'badge', genre: 'movie' },
  // Song Lyrics
  { id: 'badge_lyric_always_love_you',   name: "I will always love you",        price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_dont_stop',         name: "Don't stop believin'",          price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_shake_it_off',      name: "Shake it off",                  price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_dancing_queen',     name: "Dancing queen",                 price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_hold_your_hand',    name: "I want to hold your hand",      price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_born_to_run',       name: "Born to run",                   price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_sweet_child',       name: "Sweet child o' mine",           price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_living_on_prayer',  name: "Livin' on a prayer",            price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_purple_rain',       name: "Purple rain",                   price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_good_as_hell',      name: "Good as hell",                  price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_blinding_lights',   name: "Blinding Lights",               price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_as_it_was',         name: "As it was",                     price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_flowers',           name: "Flowers",                       price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_golden_hour',       name: "Golden hour",                   price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_wonderful_world',   name: "What a wonderful world",        price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_dont_worry',        name: "Don't worry, be happy",         price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_here_comes_sun',    name: "Here comes the sun",            price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_september',         name: "Do you remember September",     price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_lovely_day',        name: "Lovely day",                    price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_happy',             name: "Happy",                         price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_cant_stop_feeling', name: "Can't stop the feeling!",       price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_walking_sunshine',  name: "Walking on sunshine",           price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_good_vibrations',   name: "Good vibrations",               price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_uptown_funk',       name: "Uptown funk",                   price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_stronger',          name: "What doesn't kill you",         price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_roar',              name: "Hear me roar",                  price: 50, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_eye_of_tiger',      name: "Eye of the tiger",              price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_lose_yourself',     name: "Lose yourself",                 price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_we_will_rock_you',  name: "We will rock you",              price: 75, category: 'badge', genre: 'lyric' },
  { id: 'badge_lyric_dont_forget',       name: "Don't you forget about me",     price: 50, category: 'badge', genre: 'lyric' },
  // Quips
  { id: 'badge_quip_main_character',     name: "Main character energy",         price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_unbothered',         name: "Unbothered",                    price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_thats_a_vibe',       name: "That's a vibe",                 price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_built_different',    name: "Built different",               price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_no_thoughts_vibes',  name: "No thoughts, just vibes",       price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_best_life',          name: "Living my best life",           price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_soft_life',          name: "Soft life era",                 price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_serotonin',          name: "Serotonin boost",               price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_its_giving',         name: "It's giving everything",        price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_chaotic_good',       name: "Chaotic good",                  price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_certified_legend',   name: "Certified legend",              price: 75, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_in_my_feels',        name: "In my feels",                   price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_plot_twist',         name: "Plot twist: thriving",          price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_delulu',             name: "Delulu but make it work",       price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_the_audacity',       name: "The audacity... I love it",     price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_woke_up',            name: "I woke up like this",           price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_not_average',        name: "Not your average human",        price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_for_the_story',      name: "Doing it for the story",        price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_manifesting',        name: "Manifesting daily",             price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_energy',             name: "Energy is contagious",          price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_zero_regrets',       name: "Zero regrets",                  price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_this_is_the_way',    name: "This is the way",               price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_good_vibes',         name: "Sending good vibes",            price: 50, category: 'badge', genre: 'quip' },
  { id: 'badge_quip_absolutely',         name: "Absolutely unhinged",           price: 50, category: 'badge', genre: 'quip' },
];

// College teams — solid single-color rings
const COLLEGE_TEAMS = [
  // SEC
  {slug:'alabama',        name:'Alabama',         conf:'SEC',  c:'#9E1B32'},
  {slug:'georgia',        name:'Georgia',         conf:'SEC',  c:'#BA0C2F'},
  {slug:'lsu',            name:'LSU',             conf:'SEC',  c:'#461D7C'},
  {slug:'tennessee',      name:'Tennessee',       conf:'SEC',  c:'#FF8200'},
  {slug:'florida',        name:'Florida',         conf:'SEC',  c:'#0021A5'},
  {slug:'auburn',         name:'Auburn',          conf:'SEC',  c:'#0C2340'},
  {slug:'texas_am',       name:'Texas A&M',       conf:'SEC',  c:'#500000'},
  {slug:'oklahoma',       name:'Oklahoma',        conf:'SEC',  c:'#841617'},
  {slug:'kentucky',       name:'Kentucky',        conf:'SEC',  c:'#0033A0'},
  {slug:'arkansas',       name:'Arkansas',        conf:'SEC',  c:'#9D2235'},
  {slug:'ole_miss',       name:'Ole Miss',        conf:'SEC',  c:'#CE1126'},
  {slug:'mississippi_st', name:'Mississippi St',  conf:'SEC',  c:'#660000'},
  // Big Ten
  {slug:'michigan',       name:'Michigan',        conf:'Big Ten', c:'#00274C'},
  {slug:'ohio_state',     name:'Ohio State',      conf:'Big Ten', c:'#BB0000'},
  {slug:'penn_state',     name:'Penn State',      conf:'Big Ten', c:'#041E42'},
  {slug:'michigan_state', name:'Michigan State',  conf:'Big Ten', c:'#18453B'},
  {slug:'wisconsin',      name:'Wisconsin',       conf:'Big Ten', c:'#C5050C'},
  {slug:'iowa',           name:'Iowa',            conf:'Big Ten', c:'#FFCD00'},
  {slug:'nebraska',       name:'Nebraska',        conf:'Big Ten', c:'#E41C38'},
  {slug:'northwestern',   name:'Northwestern',    conf:'Big Ten', c:'#4E2683'},
  {slug:'minnesota',      name:'Minnesota',       conf:'Big Ten', c:'#7A0019'},
  {slug:'indiana',        name:'Indiana',         conf:'Big Ten', c:'#990000'},
  // Big 12
  {slug:'texas',          name:'Texas',           conf:'Big 12', c:'#BF5700'},
  {slug:'kansas_state',   name:'Kansas State',    conf:'Big 12', c:'#512888'},
  {slug:'iowa_state',     name:'Iowa State',      conf:'Big 12', c:'#C8102E'},
  {slug:'baylor',         name:'Baylor',          conf:'Big 12', c:'#154734'},
  {slug:'tcu',            name:'TCU',             conf:'Big 12', c:'#4D1979'},
  {slug:'oklahoma_state', name:'Oklahoma State',  conf:'Big 12', c:'#FF6600'},
  // ACC
  {slug:'clemson',        name:'Clemson',         conf:'ACC', c:'#F66733'},
  {slug:'florida_state',  name:'Florida State',   conf:'ACC', c:'#782F40'},
  {slug:'miami_fl',       name:'Miami FL',        conf:'ACC', c:'#F47321'},
  {slug:'notre_dame',     name:'Notre Dame',      conf:'ACC', c:'#0C1A3C'},
  {slug:'unc',            name:'UNC',             conf:'ACC', c:'#4B9CD3'},
  {slug:'duke',           name:'Duke',            conf:'ACC', c:'#003087'},
  // Pac / Independent
  {slug:'usc',            name:'USC',             conf:'Pac', c:'#990000'},
  {slug:'ucla',           name:'UCLA',            conf:'Pac', c:'#2D68C4'},
  {slug:'oregon',         name:'Oregon',          conf:'Pac', c:'#154733'},
  {slug:'washington',     name:'Washington',      conf:'Pac', c:'#4B2E83'},
  {slug:'utah',           name:'Utah',            conf:'Pac', c:'#CC0000'},
  {slug:'byu',            name:'BYU',             conf:'Pac', c:'#002E5D'},
  {slug:'louisville',     name:'Louisville',      conf:'ACC', c:'#AD0000'},
  {slug:'stanford',       name:'Stanford',        conf:'Pac', c:'#8C1515'},
];

const COLLEGE_ITEMS = COLLEGE_TEAMS.map(t => ({
  id: `frame_college_${t.slug}_solid`,
  name: `${t.name}`,
  description: `${t.conf} · College`,
  price: 100,
  category: 'frame',
  league: 'College',
  teamSlug: t.slug,
  style: 'solid',
  colors: [t.c, t.c, t.c],
}));

// Character Frames — solid-color rings themed to famous characters (creative names)
const CHARACTER_TEAMS = [
  // ── Disney Classics ──
  {slug:'classic_mouse',     name:'Classic Mouse',            c:'#1C1C1C'},  // Mickey
  {slug:'polka_dot_mouse',   name:'Polka Dot Mouse',          c:'#E91E63'},  // Minnie
  {slug:'grumpy_duck',       name:'Grumpy Duck',              c:'#1565C0'},  // Donald
  {slug:'lovable_goof',      name:'Lovable Goofball',         c:'#2E7D32'},  // Goofy
  {slug:'loyal_pup',         name:'Loyal Yellow Pup',         c:'#FDD835'},  // Pluto
  {slug:'honey_bear',        name:'Honey Bear',               c:'#F57F17'},  // Pooh
  {slug:'gloomy_donkey',     name:'Gloomy Little Donkey',     c:'#546E7A'},  // Eeyore
  {slug:'bouncy_tiger',      name:'Bouncy Striped Tiger',     c:'#E65100'},  // Tigger
  {slug:'brave_piglet',      name:'Small But Brave Piglet',   c:'#F48FB1'},  // Piglet
  {slug:'pride_cub',         name:'Pride Rock Cub',           c:'#C99A2A'},  // Simba
  // ── Disney Princess ──
  {slug:'ocean_daughter',    name:'Ocean Daughter',           c:'#0277BD'},  // Moana
  {slug:'tower_hair',        name:'Tower Hair Princess',      c:'#7B1FA2'},  // Rapunzel
  {slug:'ice_queen',         name:'Ice Queen',                c:'#4FC3F7'},  // Elsa
  {slug:'happy_snowman',     name:'Happy Little Snowman',     c:'#B3E5FC'},  // Olaf
  {slug:'little_mermaid',    name:'Under the Sea Princess',   c:'#00796B'},  // Ariel
  {slug:'beauty_bookworm',   name:'Beauty and the Bookworm',  c:'#E65100'},  // Belle
  {slug:'diamond_rough',     name:'Diamond in the Rough',     c:'#6A1B9A'},  // Aladdin
  {slug:'warrior_princess',  name:'Warrior Princess',         c:'#B71C1C'},  // Mulan
  {slug:'tiger_princess',    name:'Tiger Princess',           c:'#00838F'},  // Jasmine
  {slug:'genie_bottle',      name:'Genie in a Bottle',        c:'#FF8F00'},  // Genie
  {slug:'brave_curls',       name:'Brave Curly Hair',         c:'#2E7D32'},  // Merida (diff green from Goofy)
  // ── Disney/Pixar ──
  {slug:'lost_fish',         name:'Lost Little Fish',         c:'#EF6C00'},  // Nemo
  {slug:'forgetful_fish',    name:'Forgetful Blue Fish',      c:'#1976D2'},  // Dory
  {slug:'lonely_robot',      name:'Lonely Little Robot',      c:'#BF360C'},  // Wall-E
  {slug:'space_ranger',      name:'Space Ranger',             c:'#4527A0'},  // Buzz
  {slug:'cowboy_sheriff',    name:'Cowboy Sheriff',           c:'#1A5276'},  // Woody
  {slug:'big_ears',          name:'Big Eared Flyer',          c:'#90CAF9'},  // Dumbo
  {slug:'cute_alien',        name:'Cute Alien',               c:'#1A237E'},  // Stitch
  {slug:'hakuna_duo',        name:'Hakuna Matata Duo',        c:'#5D4037'},  // Timon & Pumbaa
  // ── Classic Toons ──
  {slug:'wabbit',            name:'Wascally Wabbit',          c:'#78909C'},  // Bugs
  {slug:'lisping_duck',      name:'Lisping Duck',             c:'#455A64'},  // Daffy
  {slug:'cat_chase',         name:'Cat on the Chase',         c:'#9E9E9E'},  // Tom
  {slug:'cheese_lover',      name:'Cheese Lover',             c:'#795548'},  // Jerry
  {slug:'smarter_bear',      name:'Smarter Than Average',     c:'#33691E'},  // Yogi
  {slug:'yabba_dabba',       name:'Yabba Dabba Doo!',         c:'#BF360C'},  // Fred Flintstone (diff from Wall-E #BF360C → change)
  // ── Sci-Fi / Action ──
  {slug:'dark_breather',     name:'Dark Side Breather',       c:'#212121'},  // Vader
  {slug:'wise_one',          name:'Little Green Wise One',    c:'#558B2F'},  // Yoda
  {slug:'dark_knight',       name:'Dark Knight',              c:'#263238'},  // Batman
  {slug:'web_slinger',       name:'Friendly Webslinger',      c:'#C62828'},  // Spidey
  {slug:'wooden_boy',        name:'Wooden Boy',               c:'#039BE5'},  // Pinocchio
  {slug:'lost_boy',          name:'Lost Boy',                 c:'#388E3C'},  // Peter Pan
  {slug:'glowing_fairy',     name:'Glowing Fairy',            c:'#7CB342'},  // Tinker Bell
  {slug:'mad_hatter',        name:'Mad Tea Party Hatter',     c:'#7B1FA2'},  // Mad Hatter (diff from Rapunzel → #6A0572)
  {slug:'cheshire_grin',     name:'Cheshire Grin',            c:'#AD1457'},  // Cheshire Cat
  // ── Modern Icons ──
  {slug:'fuzzy_red',         name:'Fuzzy Red Friend',         c:'#D32F2F'},  // Elmo
  {slug:'sea_sponge',        name:'Square Sea Sponge',        c:'#FBC02D'},  // SpongeBob
  {slug:'electric_critter',  name:'Electric Yellow Critter',  c:'#FFEE58'},  // Pikachu
  {slug:'mystery_dog',       name:'Mystery Dog',              c:'#6D4C41'},  // Scooby
  {slug:'swamp_ogre',        name:'Swamp Ogre',               c:'#558B2F'},  // Shrek (same green as Yoda; change)
  {slug:'blue_hedgehog',     name:'Mighty Blue Hedgehog',     c:'#0D47A1'},  // Sonic
];
// Fix duplicate colors
CHARACTER_TEAMS.find(t => t.slug === 'yabba_dabba').c = '#D84315';
CHARACTER_TEAMS.find(t => t.slug === 'mad_hatter').c = '#6A0572';
CHARACTER_TEAMS.find(t => t.slug === 'swamp_ogre').c = '#4CAF50';

const CHARACTER_FRAME_ITEMS = CHARACTER_TEAMS.map(t => ({
  id:          `frame_char_${t.slug}_solid`,
  name:         t.name,
  description: 'Characters · Solid color ring',
  price:        100,
  category:    'frame',
  league:      'Characters',
  teamSlug:     t.slug,
  style:       'solid',
  colors:      [t.c, t.c, t.c],
}));

const HALO_ITEMS = [
  { id: 'halo_static',   name: 'Static Halo',   description: 'Badge text floats in a full circle around your avatar', price: 150, category: 'halo_style' },
  { id: 'halo_spinning', name: 'Spinning Halo', description: 'Badge text slowly rotates around your avatar',          price: 250, category: 'halo_style' },
];

const EFFECT_ITEMS = [
  { id: 'happy_burst',      name: 'Happy Burst',        description: 'The classic happy faces explosion',       price: 0,   category: 'effect', icon: 'happy' },
  { id: 'firework',         name: 'Firework',           description: 'Rockets launch and explode in colour',    price: 100, category: 'effect', icon: 'sparkles' },
  { id: 'sunshine_burst',   name: 'Sunshine Burst',     description: 'Golden rays radiate like a sunrise',      price: 75,  category: 'effect', icon: 'sunny' },
  { id: 'heart_flutter',    name: 'Heart Flutter',      description: 'Golden hearts float upward',              price: 75,  category: 'effect', icon: 'heart' },
  { id: 'star_shower',      name: 'Star Shower',        description: 'Stars shoot in all directions',           price: 75,  category: 'effect', icon: 'star' },
  { id: 'blue_burst',       name: 'Blue Burst',         description: 'Electric blue explosion of energy',       price: 50,  category: 'effect', icon: 'water' },
  { id: 'red_burst',        name: 'Red Burst',          description: 'Bold red burst of excitement',            price: 50,  category: 'effect', icon: 'flame' },
  // 15 new effects
  { id: 'confetti',         name: 'Confetti',           description: 'A burst of colorful confetti pieces',     price: 75,  category: 'effect', icon: 'ellipse' },
  { id: 'snow_burst',       name: 'Snow Burst',         description: 'Snowflakes swirl in all directions',      price: 75,  category: 'effect', icon: 'snow' },
  { id: 'lightning_strike', name: 'Lightning Strike',   description: 'Bolts of lightning radiate outward',      price: 75,  category: 'effect', icon: 'flash' },
  { id: 'music_float',      name: 'Music Float',        description: 'Musical notes float gently upward',       price: 50,  category: 'effect', icon: 'musical-note' },
  { id: 'money_rain',       name: 'Money Rain',         description: 'Coins and cash shower down',              price: 75,  category: 'effect', icon: 'cash' },
  { id: 'flower_burst',     name: 'Flower Burst',       description: 'Blossoms explode in every direction',     price: 75,  category: 'effect', icon: 'flower' },
  { id: 'leaf_shower',      name: 'Leaf Shower',        description: 'Autumn leaves drift gracefully upward',   price: 50,  category: 'effect', icon: 'leaf' },
  { id: 'trophy_shower',    name: 'Trophy Shower',      description: 'Gold trophies rain down in glory',        price: 100, category: 'effect', icon: 'trophy' },
  { id: 'diamond_burst',    name: 'Diamond Burst',      description: 'Gems and crystals burst outward',         price: 100, category: 'effect', icon: 'diamond' },
  { id: 'green_burst',      name: 'Green Burst',        description: 'Emerald green energy explosion',          price: 50,  category: 'effect', icon: 'ellipse' },
  { id: 'purple_burst',     name: 'Purple Burst',       description: 'Violet and magenta radiant burst',        price: 50,  category: 'effect', icon: 'ellipse' },
  { id: 'orange_burst',     name: 'Orange Burst',       description: 'Warm sunset orange energy wave',          price: 50,  category: 'effect', icon: 'ellipse' },
  { id: 'sparkle_rain',     name: 'Sparkle Rain',       description: 'Golden sparkles drift down like stardust', price: 75, category: 'effect', icon: 'sparkles' },
  { id: 'planet_burst',     name: 'Cosmic Burst',       description: 'Planets and stars shoot outward',         price: 100, category: 'effect', icon: 'planet' },
  { id: 'neon_burst',       name: 'Neon Burst',         description: 'Ultra-bright neon explosion of color',    price: 150, category: 'effect', icon: 'ellipse' },
];

// ─── Featured Drops ───────────────────────────────────────────────────────────
// Limited-time collections. expires_at: null = never expires.
// Items are also included in SHOP_ITEMS so the purchase flow works normally.

const FEATURED_DROPS = [
  {
    id: 'america250',
    title: "America's 250th",
    subtitle: 'Limited-time patriotic collection · Expires July 4, 2026',
    emoji: '🇺🇸',
    accentColor: '#B22234',
    expires_at: '2026-07-04T23:59:59Z',
    items: [
      // ── Patriotic Profile Frames (Flag-style stripe rings) ───────────────
      // The Flag: 13 alternating red/white stripes + blue canton with stars
      { id: 'frame_america_flag_stripe',     name: 'The Flag',          description: '13 Red & White Stripes · Blue Canton', price: 150, category: 'frame', style: 'stripe', colors: ['#B22234','#FFFFFF','#3C3B6E'], featured: true, dropId: 'america250', league: 'america' },
      // Patriot: Navy stripes + red canton
      { id: 'frame_america_patriot_stripe',  name: 'Patriot',           description: 'Navy & Red Stripes · Red Canton',       price: 150, category: 'frame', style: 'stripe', colors: ['#3C3B6E','#FFFFFF','#B22234'], featured: true, dropId: 'america250', league: 'america' },
      // Liberty: Red stripes + gold canton
      { id: 'frame_america_liberty_stripe',  name: 'Liberty Gold',      description: 'Red & White Stripes · Gold Canton',     price: 150, category: 'frame', style: 'stripe', colors: ['#B22234','#FFFFFF','#C5A028'], featured: true, dropId: 'america250', league: 'america' },

      // ── Presidential Quotes ───────────────────────────────────────────────
      { id: 'badge_america_ask_not',      name: 'Ask not what your country can do for you', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_fear_itself',  name: 'The only thing we have to fear is fear itself', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_malice_none',  name: 'With malice toward none', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_shining_city', name: 'A shining city on a hill', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_pursuit',      name: 'Life, liberty & the pursuit of happiness', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_buck_stops',   name: 'The buck stops here', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_speak_softly', name: 'Speak softly and carry a big stick', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_well_done',    name: 'Well done is better than well said', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_government',   name: 'Government of the people, by the people', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },
      { id: 'badge_america_truth_evident',name: 'We hold these truths to be self-evident', price: 75, category: 'badge', genre: 'america_quote', featured: true, dropId: 'america250' },

      // ── American Spirit Phrases ───────────────────────────────────────────
      { id: 'badge_america_god_bless',    name: 'God Bless America', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_land_free',    name: 'Land of the free, home of the brave', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_sea_shine',    name: 'From sea to shining sea', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_pluribus',     name: 'E Pluribus Unum · Out of many, one', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_let_freedom',  name: 'Let freedom ring', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_united',       name: 'United we stand', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_dream',        name: 'Living the American Dream', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_proud',        name: 'Proud to be an American', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_250',          name: '250 years strong 🇺🇸', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_sweet_land',   name: 'Sweet land of liberty', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_stars_stripes',name: 'Stars & Stripes forever', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
      { id: 'badge_america_in_god',       name: 'In God we trust', price: 75, category: 'badge', genre: 'america_spirit', featured: true, dropId: 'america250' },
    ],
  },
];

// Flatten all featured items into their own array, then merge into SHOP_ITEMS
const FEATURED_ITEMS = FEATURED_DROPS.flatMap(d => d.items);
const SHOP_ITEMS = [...EFFECT_ITEMS, ...FRAME_ITEMS, ...COLLEGE_ITEMS, ...CHARACTER_FRAME_ITEMS, ...BADGE_ITEMS, ...HALO_ITEMS, ...FEATURED_ITEMS];

// ─── Featured endpoint ─────────────────────────────────────────────────────────
fastify.get('/shop/featured', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const unlockRes = await pool.query('SELECT item_id FROM user_unlocks WHERE user_id = $1', [request.user.id]);
    const ownedIds  = new Set(unlockRes.rows.map(r => r.item_id));
    const now       = new Date();

    const drops = FEATURED_DROPS
      .filter(d => !d.expires_at || new Date(d.expires_at) > now)
      .map(d => ({
        id:          d.id,
        title:       d.title,
        subtitle:    d.subtitle,
        emoji:       d.emoji,
        accentColor: d.accentColor,
        expires_at:  d.expires_at,
        items:       d.items.map(item => ({
          ...item,
          owned:    ownedIds.has(item.id),
          equipped: false, // not needed for featured display
        })),
      }));

    return { drops };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/auth/register', async (request, reply) => {
  const { name, email, password } = request.body;
  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'All fields required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(400).send({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const handle = '@' + name.toLowerCase().replace(/\s/g, '') + Math.floor(Math.random() * 999);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, handle) VALUES ($1, $2, $3, $4) RETURNING id, name, email, handle',
      [name, email, passwordHash, handle]
    );
    const user = result.rows[0];
    const token = fastify.jwt.sign({ id: user.id, email: user.email, handle: user.handle });
    return { success: true, token, user };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'No account found' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Incorrect password' });
    }
    const token = fastify.jwt.sign({ id: user.id, email: user.email, handle: user.handle });
    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, handle: user.handle, onboarded: user.onboarded ?? false } };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/push-token', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { pushToken } = request.body;
  if (!pushToken) return reply.status(400).send({ error: 'pushToken required' });
  try {
    await pool.query('UPDATE users SET push_token = $1 WHERE id = $2', [pushToken, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/change-password', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { currentPassword, newPassword } = request.body;
  if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'Both passwords required' });
  if (newPassword.length < 8) return reply.status(400).send({ error: 'New password must be at least 8 characters' });
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.delete('/auth/account', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { password } = request.body;
  if (!password) return reply.status(400).send({ error: 'Password required' });
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) return reply.status(401).send({ error: 'Incorrect password' });
    const uid = request.user.id;
    await pool.query('DELETE FROM notifications WHERE user_id = $1 OR actor_id = $1', [uid]);
    await pool.query('DELETE FROM smiles WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM comments WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM follows WHERE follower_id = $1 OR following_id = $1', [uid]);
    await pool.query('DELETE FROM posts WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/forgot-password', async (request, reply) => {
  const { email } = request.body;
  if (!email) return reply.status(400).send({ error: 'Email required' });
  try {
    const result = await pool.query('SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (result.rows.length === 0) return { success: true };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query('UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3', [code, expires, result.rows[0].id]);
    await sendEmail(email, 'Your Happ-E password reset code',
      `<p>Hi ${result.rows[0].name},</p><p>Your password reset code is: <strong>${code}</strong></p><p>This code expires in 15 minutes. If you didn't request this, ignore this email.</p>`
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/reset-password', async (request, reply) => {
  const { email, code, newPassword } = request.body;
  if (!email || !code || !newPassword) return reply.status(400).send({ error: 'Email, code, and new password required' });
  if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND password_reset_token = $2 AND password_reset_expires > NOW()',
      [email, code]
    );
    if (result.rows.length === 0) return reply.status(400).send({ error: 'Invalid or expired code' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2', [hash, result.rows[0].id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

// GET /profile/me
fastify.get('/profile/me', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'SELECT id, name, email, handle, bio, category, location, website, avatar_url, verified, created_at, coins, selected_effect, selected_frame, selected_badge, badge_style FROM users WHERE id = $1',
      [request.user.id]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const postCount = await pool.query('SELECT COUNT(*) FROM posts WHERE user_id = $1', [request.user.id]);
    const followerCount = await pool.query('SELECT COUNT(*) FROM follows WHERE following_id = $1', [request.user.id]);
    const followingCount = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [request.user.id]);
    return {
      success: true,
      user: {
        ...result.rows[0],
        posts: parseInt(postCount.rows[0].count) || 0,
        followers: parseInt(followerCount.rows[0].count) || 0,
        following: parseInt(followingCount.rows[0].count) || 0,
      }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

// PUT /profile/me
fastify.put('/profile/me', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { name, bio, category, location, website, avatar_url, handle } = request.body;
  try {
    if (handle) {
      const normalized = handle.startsWith('@') ? handle : `@${handle}`;
      const conflict = await pool.query(
        'SELECT id FROM users WHERE LOWER(handle) = LOWER($1) AND id != $2',
        [normalized, request.user.id]
      );
      if (conflict.rows.length > 0) {
        return reply.status(400).send({ error: 'Handle already taken' });
      }
      const result = await pool.query(
        'UPDATE users SET name = $1, bio = $2, category = $3, location = $4, website = $5, avatar_url = COALESCE($6, avatar_url), handle = $7 WHERE id = $8 RETURNING id, name, email, handle, bio, category, location, website, avatar_url',
        [name, bio, category, location, website, avatar_url ?? null, normalized, request.user.id]
      );
      return { success: true, user: result.rows[0] };
    }
    const result = await pool.query(
      'UPDATE users SET name = $1, bio = $2, category = $3, location = $4, website = $5, avatar_url = COALESCE($6, avatar_url) WHERE id = $7 RETURNING id, name, email, handle, bio, category, location, website, avatar_url',
      [name, bio, category, location, website, avatar_url ?? null, request.user.id]
    );
    return { success: true, user: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.get('/posts/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const result = await pool.query(`
      SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
        COUNT(DISTINCT s.id) as smile_count,
        COUNT(DISTINCT c.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN smiles s ON p.id = s.post_id
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE p.id = $1
      GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
    `, [id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    const comments = await pool.query(`
      SELECT c.id, c.user_id, c.text, c.created_at, u.name, u.handle, u.avatar_url
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [id]);
    return { success: true, post: { ...result.rows[0], comments: comments.rows } };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/posts', async (request, reply) => {
  const { type, text, image_url, video_url, widescreen, author, category } = request.body;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO posts (user_id, type, text, image_url, video_url, widescreen, author_quote, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [request.user.id, type, text, image_url, video_url, widescreen || false, author || null, category || null]
    );
    // Award coins: 50 for widescreen/supportive video, 10 for any other post
    const coinReward = (widescreen === true || widescreen === 'true') ? 50 : 10;
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinReward, request.user.id]);
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/posts', async (request, reply) => {
  const { category, mood, since, following, trending, cursor, limit: limitStr } = request.query;
  const sinceDate = since ? new Date(since) : null;
  const sinceValid = sinceDate && !isNaN(sinceDate.getTime());
  const limit = Math.min(parseInt(limitStr) || 20, 50);
  const cursorId = cursor ? parseInt(cursor) : null;

  // shared SELECT fragment
  const SELECT = `SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
    u.selected_frame, u.selected_badge, u.badge_style,
    COUNT(DISTINCT s.id) as smile_count,
    COUNT(DISTINCT c.id) as comment_count
  FROM posts p
  JOIN users u ON p.user_id = u.id
  LEFT JOIN smiles s ON p.id = s.post_id
  LEFT JOIN comments c ON p.id = c.post_id`;

  try {
    let result;

    if (trending === 'true') {
      const params = cursorId ? [limit + 1, cursorId] : [limit + 1];
      result = await pool.query(`
        ${SELECT}
        ${cursorId ? 'WHERE p.id < $2' : ''}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
        ORDER BY (
          (COUNT(DISTINCT s.id) * 2 + COUNT(DISTINCT c.id)) /
          POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 + 2, 1.8)
        ) DESC, p.created_at DESC
        LIMIT $1
      `, params);
    } else if (following === 'true') {
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (sinceValid) params.push(sinceDate.toISOString());
        if (cursorId) params.push(cursorId);
        params.push(limit + 1);
        result = await pool.query(`
          ${SELECT}
          WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
          ${sinceValid ? `AND p.created_at > $2::timestamptz` : ''}
          ${cursorId ? `AND p.id < $${sinceValid ? 3 : 2}` : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
          ORDER BY p.created_at DESC
          LIMIT $${params.length}
        `, params);
      } else {
        result = { rows: [] };
      }
    } else if (mood === 'true') {
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (cursorId) params.push(cursorId);
        params.push(limit + 1);
        result = await pool.query(`
          ${SELECT}
          WHERE p.category = ANY(SELECT unnest(interests) FROM users WHERE id = $1)
          ${cursorId ? `AND p.id < $2` : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
          ORDER BY p.created_at DESC
          LIMIT $${params.length}
        `, params);
      } else {
        const params = cursorId ? [cursorId, limit + 1] : [limit + 1];
        result = await pool.query(`
          ${SELECT}
          ${cursorId ? 'WHERE p.id < $1' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
          ORDER BY p.created_at DESC
          LIMIT $${cursorId ? 2 : 1}
        `, params);
      }
    } else if (category) {
      const params = [category];
      if (cursorId) params.push(cursorId);
      params.push(limit + 1);
      result = await pool.query(`
        ${SELECT}
        WHERE LOWER(p.category) = LOWER($1)
        ${cursorId ? 'AND p.id < $2' : ''}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
        ORDER BY p.created_at DESC
        LIMIT $${params.length}
      `, params);
    } else {
      const params = [];
      if (sinceValid) params.push(sinceDate.toISOString());
      if (cursorId) params.push(cursorId);
      params.push(limit + 1);
      const whereClause = sinceValid && cursorId
        ? `WHERE p.created_at > $1::timestamptz AND p.id < $2`
        : sinceValid ? `WHERE p.created_at > $1::timestamptz`
        : cursorId ? `WHERE p.id < $1`
        : '';
      result = await pool.query(`
        ${SELECT}
        ${whereClause}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified, u.selected_frame, u.selected_badge, u.badge_style
        ORDER BY p.created_at DESC
        LIMIT $${params.length}
      `, params);
    }

    const rows = result.rows ?? [];
    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && posts.length > 0 ? String(posts[posts.length - 1].id) : null;
    return { success: true, posts, has_more: hasMore, next_cursor: nextCursor };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Could not fetch posts' });
  }
});

fastify.post('/posts/:id/smile', async (request, reply) => {
  const { id } = request.params;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const existing = await pool.query('SELECT id FROM smiles WHERE user_id = $1 AND post_id = $2', [request.user.id, id]);
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM smiles WHERE user_id = $1 AND post_id = $2', [request.user.id, id]);
      // Deduct 1 coin for un-smiling (floor at 0)
      await pool.query('UPDATE users SET coins = GREATEST(coins - 1, 0) WHERE id = $1', [request.user.id]);
      return { success: true, action: 'removed' };
    }
    await pool.query('INSERT INTO smiles (user_id, post_id) VALUES ($1, $2)', [request.user.id, id]);
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (post.rows.length > 0 && post.rows[0].user_id !== request.user.id) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, $2, $3, $4)',
        [post.rows[0].user_id, 'smile', request.user.id, id]
      );
      const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
      const owner = await pool.query('SELECT push_token FROM users WHERE id = $1', [post.rows[0].user_id]);
      if (owner.rows[0]?.push_token) {
        const actorName = actor.rows[0]?.name ?? 'Someone';
        await sendPush(owner.rows[0].push_token, 'Happ-E', `${actorName} smiled at your post 😊`, { type: 'smile', postId: String(id) });
      }
    }
    // Award 1 coin to the smiler
    await pool.query('UPDATE users SET coins = coins + 1 WHERE id = $1', [request.user.id]);
    return { success: true, action: 'added' };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/posts/:id', async (request, reply) => {
  const { id } = request.params;
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const post = await pool.query('SELECT user_id, created_at, widescreen FROM posts WHERE id = $1', [id]);
    if (post.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    if (String(post.rows[0].user_id) !== String(request.user.id)) {
      return reply.status(403).send({ error: 'Not your post' });
    }
    await pool.query('DELETE FROM notifications WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM smiles WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM comments WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    // Deduct coins if post was created within the last 24 hours
    const ageMs = Date.now() - new Date(post.rows[0].created_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      const coinPenalty = post.rows[0].widescreen ? 50 : 10;
      await pool.query('UPDATE users SET coins = GREATEST(coins - $1, 0) WHERE id = $2', [coinPenalty, request.user.id]);
    }
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/posts/:id/comment', async (request, reply) => {
  const { id } = request.params;
  const { text } = request.body;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO comments (user_id, post_id, text) VALUES ($1, $2, $3) RETURNING *',
      [request.user.id, id, text]
    );
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (post.rows.length > 0 && post.rows[0].user_id !== request.user.id) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, $2, $3, $4)',
        [post.rows[0].user_id, 'comment', request.user.id, id]
      );
      const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
      const owner = await pool.query('SELECT push_token FROM users WHERE id = $1', [post.rows[0].user_id]);
      if (owner.rows[0]?.push_token) {
        const actorName = actor.rows[0]?.name ?? 'Someone';
        await sendPush(owner.rows[0].push_token, 'Happ-E', `${actorName} commented on your post`, { type: 'comment', postId: String(id) });
      }
    }
    // Award 5 coins to the commenter — only for their FIRST comment on this post
    const prevComments = await pool.query(
      'SELECT id FROM comments WHERE user_id = $1 AND post_id = $2 AND id != $3',
      [request.user.id, id, result.rows[0].id]
    );
    if (prevComments.rows.length === 0) {
      await pool.query('UPDATE users SET coins = coins + 5 WHERE id = $1', [request.user.id]);
    }
    return { success: true, comment: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// GET /profile/me/interests
fastify.get('/profile/me/interests', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query('SELECT interests FROM users WHERE id = $1', [request.user.id]);
    return { success: true, interests: result.rows[0]?.interests ?? [] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// PUT /profile/me/interests
fastify.put('/profile/me/interests', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { interests } = request.body;
  if (!Array.isArray(interests) || interests.length < 3) {
    return reply.status(400).send({ error: 'Select at least 3 interests' });
  }
  try {
    await pool.query('UPDATE users SET interests = $1 WHERE id = $2', [interests, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// POST /onboarding/complete
fastify.post('/onboarding/complete', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { interests } = request.body;
  if (!Array.isArray(interests) || interests.length < 3) {
    return reply.status(400).send({ error: 'Select at least 3 interests' });
  }
  try {
    await pool.query(
      'UPDATE users SET interests = $1, onboarded = true WHERE id = $2',
      [interests, request.user.id]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// GET /profile/me/posts
fastify.get('/profile/me/posts', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      `SELECT posts.id, posts.type, posts.text, posts.image_url, posts.video_url, posts.created_at,
              COUNT(DISTINCT s.id) as smile_count
       FROM posts
       LEFT JOIN smiles s ON posts.id = s.post_id
       WHERE posts.user_id = $1
       GROUP BY posts.id
       ORDER BY posts.created_at DESC`,
      [request.user.id]
    );
    return { success: true, posts: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Follows ---

fastify.post('/follows/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  if (parseInt(id) === request.user.id) return reply.status(400).send({ error: 'Cannot follow yourself' });
  try {
    await pool.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, id]
    );
    await pool.query(
      'INSERT INTO notifications (user_id, type, actor_id) VALUES ($1, $2, $3)',
      [id, 'follow', request.user.id]
    );
    const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
    const followed = await pool.query('SELECT push_token FROM users WHERE id = $1', [id]);
    if (followed.rows[0]?.push_token) {
      const actorName = actor.rows[0]?.name ?? 'Someone';
      await sendPush(followed.rows[0].push_token, 'Happ-E', `${actorName} started following you`, { type: 'follow' });
    }
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/follows/:id/check', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  try {
    const result = await pool.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [request.user.id, id]
    );
    return { following: result.rows.length > 0 };
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/follows/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  try {
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [request.user.id, id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/follows/following', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY u.name ASC`,
      [request.user.id]
    );
    return { users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Coins & Shop ---

fastify.get('/coins', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      'SELECT coins, selected_effect, selected_frame, selected_badge, badge_style FROM users WHERE id = $1',
      [request.user.id]
    );
    const row = result.rows[0] ?? {};
    return {
      coins: row.coins ?? 0,
      selected_effect: row.selected_effect ?? 'happy_burst',
      selected_frame: row.selected_frame ?? null,
      selected_badge: row.selected_badge ?? null,
      badge_style: row.badge_style ?? 'chip',
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// Public debug endpoint — returns item counts per category/league (no auth)
fastify.get('/shop/debug-counts', async (request, reply) => {
  const counts = {};
  for (const item of SHOP_ITEMS) {
    const key = `${item.category}/${item.league ?? item.genre ?? '-'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { total: SHOP_ITEMS.length, counts };
});

fastify.get('/shop/items', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const unlockRes = await pool.query('SELECT item_id FROM user_unlocks WHERE user_id = $1', [request.user.id]);
    const userRes = await pool.query(
      'SELECT selected_effect, selected_frame, selected_badge, badge_style FROM users WHERE id = $1',
      [request.user.id]
    );
    const ownedIds = new Set(unlockRes.rows.map(r => r.item_id));
    ownedIds.add('happy_burst'); // always owned
    const u = userRes.rows[0] ?? {};
    const selectedEffect = u.selected_effect ?? 'happy_burst';
    const selectedFrame  = u.selected_frame  ?? null;
    const selectedBadge  = u.selected_badge  ?? null;
    const badgeStyle     = u.badge_style     ?? 'chip';

    const items = SHOP_ITEMS.map(item => {
      let equipped = false;
      if (item.category === 'effect')     equipped = item.id === selectedEffect;
      if (item.category === 'frame')      equipped = item.id === selectedFrame;
      if (item.category === 'badge')      equipped = item.id === selectedBadge;
      if (item.category === 'halo_style') equipped = item.id === badgeStyle;
      return { ...item, owned: ownedIds.has(item.id), equipped };
    });
    return { items };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/shop/purchase/:itemId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { itemId } = request.params;
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return reply.status(404).send({ error: 'Item not found' });
  if (item.price === 0) return reply.status(400).send({ error: 'Item is free' });
  try {
    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [request.user.id]);
    const coins = userRes.rows[0]?.coins ?? 0;
    if (coins < item.price) return reply.status(400).send({ error: 'Not enough coins' });
    // Check already owned
    const existing = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, itemId]);
    if (existing.rows.length > 0) return reply.status(400).send({ error: 'Already owned' });
    await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [item.price, request.user.id]);
    await pool.query('INSERT INTO user_unlocks (user_id, item_id) VALUES ($1, $2)', [request.user.id, itemId]);
    const updated = await pool.query('SELECT coins FROM users WHERE id = $1', [request.user.id]);
    return { success: true, coins: updated.rows[0].coins };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.put('/shop/select-effect', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { effectId } = request.body;
  if (!SHOP_ITEMS.find(i => i.id === effectId)) return reply.status(404).send({ error: 'Effect not found' });
  try {
    // Must own it (or be free)
    const item = SHOP_ITEMS.find(i => i.id === effectId);
    if (item.price > 0) {
      const owned = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, effectId]);
      if (owned.rows.length === 0) return reply.status(403).send({ error: 'Not owned' });
    }
    await pool.query('UPDATE users SET selected_effect = $1 WHERE id = $2', [effectId, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/shop/my-unlocks', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const unlockRes = await pool.query('SELECT item_id FROM user_unlocks WHERE user_id = $1', [request.user.id]);
    const userRes = await pool.query(
      'SELECT selected_effect, selected_frame, selected_badge, badge_style FROM users WHERE id = $1',
      [request.user.id]
    );
    const unlocks = ['happy_burst', ...unlockRes.rows.map(r => r.item_id)];
    const u = userRes.rows[0] ?? {};
    return {
      unlocks,
      selected_effect: u.selected_effect ?? 'happy_burst',
      selected_frame:  u.selected_frame  ?? null,
      selected_badge:  u.selected_badge  ?? null,
      badge_style:     u.badge_style     ?? 'chip',
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- New shop select endpoints ---

fastify.put('/shop/select-frame', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { frameId } = request.body;
  if (frameId !== null && !SHOP_ITEMS.find(i => i.id === frameId && i.category === 'frame')) {
    return reply.status(404).send({ error: 'Frame not found' });
  }
  try {
    if (frameId !== null) {
      const owned = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, frameId]);
      if (owned.rows.length === 0) return reply.status(403).send({ error: 'Not owned' });
    }
    await pool.query('UPDATE users SET selected_frame = $1 WHERE id = $2', [frameId, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.put('/shop/select-badge', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { badgeId } = request.body;
  if (badgeId !== null && !SHOP_ITEMS.find(i => i.id === badgeId && i.category === 'badge')) {
    return reply.status(404).send({ error: 'Badge not found' });
  }
  try {
    if (badgeId !== null) {
      const owned = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, badgeId]);
      if (owned.rows.length === 0) return reply.status(403).send({ error: 'Not owned' });
    }
    await pool.query('UPDATE users SET selected_badge = $1 WHERE id = $2', [badgeId, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.put('/shop/select-badge-style', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { style } = request.body;
  if (!['chip', 'halo_static', 'halo_spinning'].includes(style)) {
    return reply.status(400).send({ error: 'Invalid style' });
  }
  try {
    // halo_static / halo_spinning must be owned
    if (style !== 'chip') {
      const owned = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, style]);
      if (owned.rows.length === 0) return reply.status(403).send({ error: 'Not owned' });
    }
    await pool.query('UPDATE users SET badge_style = $1 WHERE id = $2', [style, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- User search ---

fastify.get('/users/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const result = await pool.query(
      `SELECT id, name, handle, bio, category, location, avatar_url, verified, created_at FROM users WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const postCount = await pool.query('SELECT COUNT(*) FROM posts WHERE user_id = $1', [id]);
    const followerCount = await pool.query('SELECT COUNT(*) FROM follows WHERE following_id = $1', [id]);
    const followingCount = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [id]);
    const posts = await pool.query(
      `SELECT posts.id, posts.type, posts.text, posts.image_url, posts.video_url, posts.created_at,
              COUNT(DISTINCT s.id) as smile_count
       FROM posts LEFT JOIN smiles s ON posts.id = s.post_id
       WHERE posts.user_id = $1 GROUP BY posts.id ORDER BY posts.created_at DESC`,
      [id]
    );
    return {
      success: true,
      user: {
        ...result.rows[0],
        posts: parseInt(postCount.rows[0].count) || 0,
        followers: parseInt(followerCount.rows[0].count) || 0,
        following: parseInt(followingCount.rows[0].count) || 0,
      },
      userPosts: posts.rows,
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/search', async (request, reply) => {
  const { q } = request.query;
  if (!q || q.trim().length === 0) return { success: true, users: [] };
  const term = `%${q.trim().toLowerCase()}%`;
  try {
    const result = await pool.query(
      `SELECT id, name, handle, category, avatar_url, verified FROM users
       WHERE LOWER(name) LIKE $1 OR LOWER(handle) LIKE $1 OR LOWER(category) LIKE $1
       LIMIT 30`,
      [term]
    );
    return { success: true, users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/suggested', async (request, reply) => {
  try {
    const result = await pool.query(
      `SELECT id, name, handle, category, avatar_url, verified FROM users ORDER BY created_at DESC LIMIT 20`
    );
    return { success: true, users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Notifications ---

fastify.get('/notifications', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT n.id, n.type, n.read, n.created_at, n.post_id, n.actor_id,
              u.name as actor_name, u.handle as actor_handle, u.avatar_url as actor_avatar_url
       FROM notifications n
       JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [request.user.id]
    );
    return { success: true, notifications: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/notifications/read-all', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Messages ---

fastify.get('/messages', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const userId = request.user.id;
    const result = await pool.query(`
      SELECT DISTINCT ON (partner_id)
        CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as partner_id,
        m.text as last_message,
        m.created_at as last_at,
        m.sender_id,
        u.name, u.handle, u.avatar_url
      FROM messages m
      JOIN users u ON u.id = (CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END)
      WHERE m.sender_id = $1 OR m.receiver_id = $1
      ORDER BY partner_id, m.created_at DESC
    `, [userId]);
    const unread = await pool.query(
      'SELECT sender_id as partner_id, COUNT(*) as count FROM messages WHERE receiver_id = $1 AND NOT read GROUP BY sender_id',
      [userId]
    );
    const unreadMap = {};
    unread.rows.forEach(r => { unreadMap[r.partner_id] = parseInt(r.count); });
    const conversations = result.rows
      .map(r => ({ ...r, unread: unreadMap[r.partner_id] ?? 0 }))
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
    return { success: true, conversations };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/messages/:userId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const me = request.user.id;
    const other = request.params.userId;
    const result = await pool.query(`
      SELECT m.id, m.sender_id, m.receiver_id, m.text, m.created_at, m.read,
        s.name as sender_name, s.handle as sender_handle, s.avatar_url as sender_avatar
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [me, other]);
    return { success: true, messages: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/messages/:userId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const me = request.user.id;
    const other = request.params.userId;
    const { text, gif_url } = request.body;
    if (!text?.trim() && !gif_url) return reply.status(400).send({ error: 'Message text or gif required' });
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, text, gif_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [me, other, text?.trim() ?? '', gif_url ?? null]
    );
    const [sender, receiver] = await Promise.all([
      pool.query('SELECT name FROM users WHERE id = $1', [me]),
      pool.query('SELECT push_token FROM users WHERE id = $1', [other]),
    ]);
    if (receiver.rows[0]?.push_token) {
      const preview = gif_url ? 'Sent a GIF' : (text?.trim() ?? '');
      await sendPush(receiver.rows[0].push_token, sender.rows[0]?.name ?? 'Someone', preview, { type: 'message', userId: String(me) });
    }
    return { success: true, message: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/messages/unread-count', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND NOT read',
      [request.user.id]
    );
    return { success: true, count: parseInt(result.rows[0].count) || 0 };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/messages/:userId/read', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query(
      'UPDATE messages SET read = true WHERE sender_id = $1 AND receiver_id = $2 AND NOT read',
      [request.params.userId, request.user.id]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Comment deletion ---

fastify.delete('/posts/:postId/comments/:commentId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { postId, commentId } = request.params;
  try {
    const check = await pool.query('SELECT user_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
    if (check.rows.length === 0) return reply.status(404).send({ error: 'Comment not found' });
    if (String(check.rows[0].user_id) !== String(request.user.id)) return reply.status(403).send({ error: 'Forbidden' });
    await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post reporting ---

fastify.post('/posts/:id/report', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { reason } = request.body;
  try {
    await pool.query(
      'INSERT INTO reports (reporter_id, post_id, reason) VALUES ($1, $2, $3) ON CONFLICT (reporter_id, post_id) DO UPDATE SET reason = EXCLUDED.reason',
      [request.user.id, request.params.id, reason ?? 'unspecified']
    );
    const [reporter, post] = await Promise.all([
      pool.query('SELECT name, email FROM users WHERE id = $1', [request.user.id]),
      pool.query('SELECT p.text, p.image_url, u.name as author FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = $1', [request.params.id]),
    ]);
    await sendEmail(
      'oops@happe.com',
      `Post reported — ${reason ?? 'unspecified'}`,
      `<p><b>Reported by:</b> ${reporter.rows[0]?.name} (${reporter.rows[0]?.email})</p>
       <p><b>Post author:</b> ${post.rows[0]?.author}</p>
       <p><b>Post text:</b> ${post.rows[0]?.text ?? '(no text)'}</p>
       <p><b>Reason:</b> ${reason ?? 'unspecified'}</p>
       <p><b>Post ID:</b> ${request.params.id}</p>`
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Blocked users ---

fastify.post('/users/:id/block', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const blockedId = parseInt(request.params.id);
  if (blockedId === request.user.id) return reply.status(400).send({ error: 'Cannot block yourself' });
  try {
    await pool.query(
      'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, blockedId]
    );
    await pool.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [request.user.id, blockedId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/users/:id/block', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [request.user.id, parseInt(request.params.id)]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/blocked', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url FROM blocked_users b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [request.user.id]
    );
    return { success: true, blocked: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Notification preferences ---

fastify.put('/profile/me/notifications', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { push, inspire, comments, likes } = request.body;
  try {
    const prefs = { push: !!push, inspire: !!inspire, comments: !!comments, likes: !!likes };
    await pool.query('UPDATE users SET notification_preferences = $1::jsonb WHERE id = $2', [JSON.stringify(prefs), request.user.id]);
    return { success: true, preferences: prefs };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post editing ---

fastify.put('/posts/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { text } = request.body;
  try {
    const check = await pool.query('SELECT user_id FROM posts WHERE id = $1', [request.params.id]);
    if (check.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    if (String(check.rows[0].user_id) !== String(request.user.id)) return reply.status(403).send({ error: 'Forbidden' });
    const result = await pool.query('UPDATE posts SET text = $1 WHERE id = $2 RETURNING *', [text, request.params.id]);
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post search ---

fastify.get('/posts/search', async (request, reply) => {
  const { q } = request.query;
  if (!q || q.trim().length === 0) return { success: true, posts: [] };
  const term = `%${q.trim().toLowerCase()}%`;
  try {
    const result = await pool.query(
      `SELECT p.id, p.type, p.text, p.image_url, p.video_url, p.created_at,
              u.id as user_id, u.name, u.handle, u.avatar_url,
              COUNT(DISTINCT s.id) as smile_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN smiles s ON p.id = s.post_id
       WHERE LOWER(p.text) LIKE $1
       GROUP BY p.id, u.id, u.name, u.handle, u.avatar_url
       ORDER BY p.created_at DESC
       LIMIT 30`,
      [term]
    );
    return { success: true, posts: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Sparks ---

const SPARK_PROMPTS = [
  "Show us your workspace right now — messy or not.",
  "What's the last thing you made with your hands?",
  "Share a tool you couldn't live without.",
  "Show us something you made that you're proud of.",
  "What does your creative process look like?",
  "Show us a work in progress.",
  "Share your favorite spot to create.",
  "What's the hardest thing you've ever made?",
  "Show us something you made as a gift.",
  "What got you started in your craft?",
  "Share a before and after of your latest project.",
  "Show us your most-used piece of gear.",
  "What's something you're still learning?",
  "Share a recent mistake that taught you something.",
  "Show us your creative setup.",
];

fastify.get('/sparks/current', async (request, reply) => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const responseCount = await pool.query(
      `SELECT COUNT(*) FROM posts WHERE spark_prompt = $1`, [prompt]
    );
    return {
      success: true,
      spark: {
        prompt,
        responses: parseInt(responseCount.rows[0].count) || 0,
      }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/sparks/current/responses', async (request, reply) => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.handle, u.avatar_url,
              COUNT(DISTINCT s.id) as smile_count,
              COUNT(DISTINCT c.id) as comment_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN smiles s ON p.id = s.post_id
       LEFT JOIN comments c ON p.id = c.post_id
       WHERE p.spark_prompt = $1
       GROUP BY p.id, u.name, u.handle, u.avatar_url
       ORDER BY smile_count DESC
       LIMIT 20`,
      [prompt]
    );
    return { success: true, responses: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/sparks/current/respond', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { text, image_url, video_url, type } = request.body;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const result = await pool.query(
      'INSERT INTO posts (user_id, type, text, image_url, video_url, spark_prompt) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [request.user.id, type || 'image', text, image_url || null, video_url || null, prompt]
    );
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// TEMP admin route — will be removed after use
fastify.post('/admin/give-coins', async (request, reply) => {
  if (request.headers['x-admin-secret'] !== 'happe-admin-2026') return reply.status(403).send({ error: 'Forbidden' });
  const { handle, coins } = request.body;
  try {
    const result = await pool.query(
      `UPDATE users SET coins = coins + $1 WHERE LOWER(handle) = LOWER($2) RETURNING id, handle, coins`,
      [coins, handle]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { success: true, user: result.rows[0] };
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      handle VARCHAR(100) UNIQUE NOT NULL,
      bio TEXT DEFAULT '',
      category VARCHAR(100) DEFAULT '',
      location VARCHAR(100) DEFAULT '',
      website VARCHAR(255) DEFAULT '',
      verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(20) NOT NULL,
      text TEXT,
      image_url TEXT,
      video_url TEXT,
      widescreen BOOLEAN DEFAULT false,
      author_quote TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS smiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower_id INTEGER REFERENCES users(id),
      following_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower_id, following_id)
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255) DEFAULT '';`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS spark_prompt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT '{}';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(20) NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(10) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"push":true,"inspire":true,"comments":true,"likes":true}'::jsonb;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id SERIAL PRIMARY KEY,
      blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(blocker_id, blocked_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL DEFAULT 'unspecified',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(reporter_id, post_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      read BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages(sender_id, receiver_id);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read);
  `);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS gif_url TEXT DEFAULT NULL;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS widescreen BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_effect VARCHAR(50) DEFAULT 'happy_burst';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_frame VARCHAR(100) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_badge VARCHAR(100) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_style VARCHAR(50) DEFAULT 'chip';`);
  // Ensure @stephen.olmo has at least 5000 coins (idempotent — won't reduce a higher balance)
  await pool.query(`UPDATE users SET coins = GREATEST(coins, 5000) WHERE LOWER(handle) = '@stephen.olmo';`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_unlocks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_id VARCHAR(50) NOT NULL,
      purchased_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, item_id)
    );
  `);
  console.log('Database ready');
};

const start = async () => {
  try {
    console.log('Starting Happ-E server...');
    await initDB();
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('Happ-E server running');
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    process.exit(1);
  }
};

start();// Tue May 19 23:35:04 EDT 2026
