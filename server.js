const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- ส่วนที่แก้ไข ---
const sessionMiddleware = session({
    store: new SQLiteStore({ db: 'baccarat.db', dir: './' }),
    secret: 'a-very-strong-secret-key-that-you-should-change',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}); // << เพิ่มวงเล็บปิดและเครื่องหมาย ; ให้ถูกต้อง
// --- จบส่วนแก้ไข ---

app.use(sessionMiddleware);
io.use((socket, next) => { sessionMiddleware(socket.request, {}, next) });

let db, gameHistory = [];
const HISTORY_LIMIT = 30;

(async () => {
    db = await open({ filename: './baccarat.db', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, balance REAL DEFAULT 1000, role TEXT DEFAULT 'player')`);
    await db.exec(`CREATE TABLE IF NOT EXISTS game_history (id INTEGER PRIMARY KEY AUTOINCREMENT, winner TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS game_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, winner TEXT NOT NULL, player_hand TEXT NOT NULL, banker_hand TEXT NOT NULL, player_score INTEGER NOT NULL, banker_score INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS bet_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, round_id INTEGER NOT NULL, bet_type TEXT NOT NULL, amount REAL NOT NULL, winnings REAL NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (round_id) REFERENCES game_rounds(id))`);
    gameHistory = await db.all(`SELECT winner FROM game_history ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`);
    gameHistory.reverse();
})();

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Forbidden: Admins only');
};

app.post('/register', async (req,res)=>{try{const{username,password}=req.body;if(!username||!password)return res.redirect('/register.html?error=Missing fields');const existingUser=await db.get('SELECT * FROM users WHERE username = ?',username);if(existingUser)return res.redirect('/register.html?error=Username taken');const password_hash=await bcrypt.hash(password,10);await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)',username,password_hash);res.redirect('/login.html')}catch(err){res.redirect('/register.html?error=Server error')}});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE username = ?', username);
    if (user && await bcrypt.compare(password, user.password_hash)) {
        req.session.user = { id: user.id, username: user.username, role: user.role };
        req.session.save(() => res.redirect('/'));
    } else {
        res.redirect('/login.html?error=Invalid credentials');
    }
});
app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login.html'))});
app.get('/',(req,res,next)=>{if(!req.session.user)return res.redirect('/login.html');res.sendFile(__dirname+'/public/index.html')});
app.get('/my-history', async (req, res) => {if(!req.session.user)return res.status(401).json({error:'Unauthorized'});try{const history=await db.all(`SELECT bh.bet_type, bh.amount, bh.winnings, gr.winner, gr.player_hand, gr.banker_hand, gr.created_at FROM bet_history bh JOIN game_rounds gr ON bh.round_id = gr.id WHERE bh.user_id = ? ORDER BY gr.created_at DESC LIMIT 50`,req.session.user.id);res.json(history)}catch(err){res.status(500).json({error:'Failed to fetch history'})}});

app.get('/admin', isAdmin, (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});
app.get('/api/users', isAdmin, async (req, res) => {
    const users = await db.all('SELECT id, username, balance, role FROM users');
    res.json(users);
});
app.post('/api/update-balance', isAdmin, async (req, res) => {
    const { userId, newBalance } = req.body;
    try {
        await db.run('UPDATE users SET balance = ? WHERE id = ?', newBalance, userId);
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

// ... โค้ดส่วน Game Logic ทั้งหมดเหมือนเดิม ...

let deck=[], timerInterval=null, countdown=20, gameState={playerHand:[],bankerHand:[],playerScore:0,bankerScore:0,allBets:{},phase:'BETTING', sideBetResults: {}}, players = {};
let cutCardDealt = false, isLastHandOfShoe = false;

function getScoreValue(v) {if(['J','Q','K','10'].includes(v)) return 0;if(v==='A') return 1;return parseInt(v);}
function getBurnValue(v) {if(['J','Q','K','10'].includes(v)) return 10;if(v==='A') return 1;return parseInt(v);}
function createDeck(){deck=[],suits=['♥','♦','♣','♠'],values=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];for(let i=0;i<6;i++)for(let s of suits)for(let v of values)deck.push({value:v,suit:s})}
function shuffleAndCutDeck(){shuffleDeck();const cutPos=deck.length-(30+Math.floor(Math.random()*31));deck.splice(cutPos,0,{value:'CUT',suit:'red'});cutCardDealt=false;isLastHandOfShoe=false}
function shuffleDeck(){for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}}
function calculateHandScore(h){return h.reduce((s,c)=> s + getScoreValue(c.value), 0) % 10}
function processBigRoad(h){if(h.length===0)return[];const c=[[]];let l=null,t=0;h.forEach(r=>{if(r.winner==='tie'){t++;return}if(r.winner!==l){if(l!==null)c.push([]);l=r.winner}const C=c[c.length-1];C.push({winner:r.winner,ties:t});t=0});if(t>0&&c.length>0&&c[0].length>0){const L=c[c.length-1];if(L.length>0){const E=L[L.length-1];E.ties+=t}}return c}

async function burnCards() {
    createDeck();
    shuffleAndCutDeck();
    gameHistory = [];
    io.emit('scoreboardUpdate', { beadPlate: [], bigRoad: [] });
    await new Promise(r => setTimeout(r, 1000));
    const burnCard = deck.pop();
    const numToBurn = getBurnValue(burnCard.value);
    const burnedCards = [burnCard];
    for (let i = 0; i < numToBurn; i++) {
        if(deck.length > 0) burnedCards.push(deck.pop());
    }
    io.emit('shoeChange', { burnCard, numToBurn, burnedCards, deckCount: deck.length });
    await new Promise(r => setTimeout(r, 4000));
}

function dealCard(hN){const card=deck.pop();if(card.value==='CUT'){cutCardDealt=true;io.emit('cutCardShown');dealCard(hN);return}gameState[hN].push(card);gameState[`${hN.replace('Hand','')}Score`]=calculateHandScore(gameState[hN]);io.emit('cardDealt',{hand:hN,card:card,score:gameState[`${hN.replace('Hand','')}Score`],deckCount:deck.length})}
async function startGame(){gameState.phase='DEALING';gameState.sideBetResults={};io.emit('newRoundStarting');if(isLastHandOfShoe)await burnCards();await new Promise(r=>setTimeout(r,1000));dealCard('playerHand');await new Promise(r=>setTimeout(r,1000));dealCard('bankerHand');await new Promise(r=>setTimeout(r,1000));dealCard('playerHand');await new Promise(r=>setTimeout(r,1000));dealCard('bankerHand');const p1=gameState.playerHand[0],p2=gameState.playerHand[1],b1=gameState.bankerHand[0],b2=gameState.bankerHand[1];if(p1.value===p2.value){gameState.sideBetResults.player_pair=true;if(p1.suit===p2.suit)gameState.sideBetResults.player_perfect_pair=true}if(b1.value===b2.value){gameState.sideBetResults.banker_pair=true;if(b1.suit===b2.suit)gameState.sideBetResults.banker_perfect_pair=true}if(gameState.sideBetResults.player_pair||gameState.sideBetResults.banker_pair)gameState.sideBetResults.any_pair=true;let{playerScore,bankerScore}=gameState;const isNatural=playerScore>=8||bankerScore>=8;gameState.sideBetResults.is_natural=isNatural;if(isNatural)return endRound();let pD=false;if(playerScore<=5){pD=true;await new Promise(r=>setTimeout(r,1000));dealCard('playerHand')}const pTV=pD?getScoreValue(gameState.playerHand[2].value):null;let bS=false;if(!pD){if(bankerScore<=5)bS=true}else{if(bankerScore<=2)bS=true;else if(bankerScore===3&&pTV!==8)bS=true;else if(bankerScore===4&&[2,3,4,5,6,7].includes(pTV))bS=true;else if(bankerScore===5&&[4,5,6,7].includes(pTV))bS=true;else if(bankerScore===6&&[6,7].includes(pTV))bS=true}if(bS){await new Promise(r=>setTimeout(r,1000));dealCard('bankerHand')}endRound()}
async function endRound(){
    gameState.phase='PAYOUT';
    let winner='';
    const scoreDiff=Math.abs(gameState.playerScore-gameState.bankerScore);
    if(gameState.playerScore>gameState.bankerScore)winner='player';else if(gameState.bankerScore>gameState.playerScore)winner='banker';else winner='tie';
    const roundResult=await db.run('INSERT INTO game_rounds (winner, player_hand, banker_hand, player_score, banker_score) VALUES (?, ?, ?, ?, ?)',winner,JSON.stringify(gameState.playerHand),JSON.stringify(gameState.bankerHand),gameState.playerScore,gameState.bankerScore);
    const roundId=roundResult.lastID;
    await db.run('INSERT INTO game_history (winner) VALUES (?)',winner);
    gameHistory.push({winner});
    if(gameHistory.length>HISTORY_LIMIT){gameHistory.shift()}
    const bigRoadData=processBigRoad(gameHistory);
    if(cutCardDealt)isLastHandOfShoe=true;
    for(const sId in gameState.allBets){
        const pS=io.sockets.sockets.get(sId);
        if(!pS)continue;
        const pI=gameState.allBets[sId];
        players[sId].lastBet={...pI.bets};
        const pB=pI.bets;
        let totalWinnings=0;
        let winningsBreakdown = [];
        for(const betType in pB){
            const betAmount=pB[betType];
            let winningsForBet=0;
            let oM=0; 
            if(winner==='tie'&&(betType==='player'||betType==='banker'))oM=1;
            else if(betType==='player'&&winner==='player')oM=2;
            else if(betType==='banker'&&winner==='banker')oM=1.95;
            else if(betType==='tie'&&winner==='tie')oM=9;
            else if(betType==='player_pair'&&gameState.sideBetResults.player_pair)oM=12;
            else if(betType==='banker_pair'&&gameState.sideBetResults.banker_pair)oM=12;
            else if(betType==='any_pair'&&gameState.sideBetResults.any_pair)oM=6;
            else if(betType==='perfect_pair'){const ppp=gameState.sideBetResults.player_perfect_pair;const bpp=gameState.sideBetResults.banker_perfect_pair;if(ppp&&bpp)oM=201;else if(ppp||bpp)oM=26}
            else if(betType===`${winner}_bonus`){if(gameState.sideBetResults.is_natural){if(winner!=='tie')oM=2}else if(scoreDiff>=4){const bonusPayouts={4:2,5:3,6:5,7:8,8:11,9:31};oM=bonusPayouts[scoreDiff]}}
            winningsForBet=betAmount*oM;
            if (winningsForBet > betAmount || (oM === 1 && betAmount > 0)) {
                winningsBreakdown.push({ type: betType, amount: winningsForBet });
            }
            totalWinnings+=winningsForBet;
            await db.run('INSERT INTO bet_history (user_id, round_id, bet_type, amount, winnings) VALUES (?, ?, ?, ?, ?)',pI.userId,roundId,betType,betAmount,winningsForBet)
        }
        if(totalWinnings>0){await db.run('UPDATE users SET balance = balance + ? WHERE id = ?',totalWinnings,pI.userId)}
        const user=await db.get('SELECT balance FROM users WHERE id = ?',pI.userId);
        pS.emit('roundResult',{winner,winnings:totalWinnings,balance:user.balance,isLastHand:isLastHandOfShoe,winningsBreakdown});
    }
    io.emit('scoreboardUpdate',{beadPlate:gameHistory,bigRoad:bigRoadData});
    console.log(`Winner: ${winner}. Round ID: ${roundId}`);
    setTimeout(startNewRound,8000)
}
function startNewRound(){gameState.phase='BETTING';gameState.allBets={};gameState.playerHand=[];gameState.bankerHand=[];gameState.playerScore=0;gameState.bankerScore=0;io.emit('allBetsUpdate',gameState.allBets);io.emit('newRoundStarting');countdown=20;io.emit('timerUpdate',{countdown,phase:'BETTING'});clearInterval(timerInterval);timerInterval=setInterval(()=>{countdown--;io.emit('timerUpdate',{countdown,phase:'BETTING'});if(countdown<=0){clearInterval(timerInterval);io.emit('dealingStarted');startGame()}},1000)}

io.on('connection', async(socket)=>{
    const session=socket.request.session;
    if(!session||!session.user){socket.disconnect(true);return}
    
    console.log(`User connected: ${session.user.username}(${socket.id})`);
    players[socket.id]={lastBet:{}};
    const user=await db.get('SELECT * FROM users WHERE id = ?',session.user.id);
    socket.emit('init',{balance:user.balance,username:user.username,history:gameHistory,deckCount:deck.length, role: user.role});
    
    socket.on('placeBet',async(bet)=>{if(gameState.phase!=='BETTING')return;const currentUser=await db.get('SELECT balance FROM users WHERE id = ?',session.user.id);let amountToBet=Math.min(bet.amount,currentUser.balance);if(amountToBet<=0)return;const playerBets=gameState.allBets[socket.id]?.bets||{};const mainBetTotal=(playerBets.player||0)+(playerBets.banker||0);let sideBetTotal=0;for(const type in playerBets){if(!['player','banker','tie'].includes(type))sideBetTotal+=playerBets[type]}if(!['player','banker','tie'].includes(bet.type)){const sideBetLimit=mainBetTotal*0.5;const remainingRoom=Math.max(0,sideBetLimit-sideBetTotal);amountToBet=Math.min(amountToBet,remainingRoom)}if(amountToBet<=0){return}await db.run('UPDATE users SET balance = balance - ? WHERE id = ?',amountToBet,session.user.id);const newBalance=currentUser.balance-amountToBet;if(!gameState.allBets[socket.id])gameState.allBets[socket.id]={userId:session.user.id,username:session.user.username,bets:{}};gameState.allBets[socket.id].bets[bet.type]=(gameState.allBets[socket.id].bets[bet.type]||0)+amountToBet;socket.emit('balanceUpdate',newBalance);io.emit('allBetsUpdate',gameState.allBets)});
    
    socket.on('clearBets',async()=>{if(gameState.phase!=='BETTING')return;const pB=gameState.allBets[socket.id];if(pB){let refund=0;for(const type in pB.bets)refund+=pB.bets[type];await db.run('UPDATE users SET balance = balance + ? WHERE id = ?',refund,pB.userId);const user=await db.get('SELECT balance FROM users WHERE id = ?',pB.userId);delete gameState.allBets[socket.id];socket.emit('balanceUpdate',user.balance);io.emit('allBetsUpdate',gameState.allBets)}});
    
    socket.on('rebet',async()=>{if(gameState.phase!=='BETTING'||!players[socket.id]||Object.keys(players[socket.id].lastBet).length===0)return;const currentUser=await db.get('SELECT balance FROM users WHERE id = ?',session.user.id);let totalRebet=0;for(const type in players[socket.id].lastBet)totalRebet+=players[socket.id].lastBet[type];if(currentUser.balance<totalRebet){socket.emit('error',{message:'เงินไม่พอสำหรับลงซ้ำ'});return}await db.run('UPDATE users SET balance = balance - ? WHERE id = ?',totalRebet,session.user.id);const newBalance=currentUser.balance-totalRebet;if(!gameState.allBets[socket.id])gameState.allBets[socket.id]={userId:session.user.id,username:session.user.username,bets:{}};gameState.allBets[socket.id].bets={...players[socket.id].lastBet};socket.emit('balanceUpdate',newBalance);io.emit('allBetsUpdate',gameState.allBets)});
    
    socket.on('moveBet', (move) => {if(gameState.phase!=='BETTING'||move.from===move.to)return;const playerBetData=gameState.allBets[socket.id];if(!playerBetData||!playerBetData.bets[move.from])return;const amount=playerBetData.bets[move.from];delete playerBetData.bets[move.from];const mainBetTotal=(playerBetData.bets.player||0)+(playerBetData.bets.banker||0);let sideBetTotal=0;for(const type in playerBetData.bets){if(!['player','banker','tie'].includes(type))sideBetTotal+=playerBetData.bets[type]}const isMovingToSideBet=!['player','banker','tie'].includes(move.to);if(isMovingToSideBet){const sideBetLimit=mainBetTotal*0.5;if(sideBetTotal+amount>sideBetLimit){playerBetData.bets[move.from]=(playerBetData.bets[move.from]||0)+amount;socket.emit('error',{message:'ไม่สามารถย้ายได้ ยอด Side Bet จะเกินกำหนด'});io.emit('allBetsUpdate',gameState.allBets);return}}playerBetData.bets[move.to]=(playerBetData.bets[move.to]||0)+amount;io.emit('allBetsUpdate',gameState.allBets)});

    socket.on('disconnect',()=>{
        if(players[socket.id] && gameState.allBets[socket.id]) {
            players[socket.id].lastBet={...gameState.allBets[socket.id].bets};
        }
        delete gameState.allBets[socket.id];
        delete players[socket.id];
        io.emit('allBetsUpdate', gameState.allBets);
        console.log(`User disconnected: ${session.user?.username}(${socket.id})`);
    });
});

server.listen(PORT,async()=>{console.log(`Baccarat Online server running on http://localhost:${PORT}`);await burnCards();startNewRound()});