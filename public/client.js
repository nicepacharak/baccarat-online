const socket = io();

// DOM Elements
const balanceEl = document.getElementById('balance');
const messageEl = document.getElementById('message');
const playerHandEl = document.getElementById('player-hand');
const bankerHandEl = document.getElementById('banker-hand');
const playerScoreEl = document.getElementById('player-score');
const bankerScoreEl = document.getElementById('banker-score');
const timerEl = document.getElementById('timer-display');
const bettingSpots = document.querySelectorAll('.spot');
const chipsContainer = document.getElementById('chips');
const clearBtn = document.getElementById('clear-btn');
const rebetBtn = document.getElementById('rebet-btn');
const totalBetEl = document.getElementById('total-bet');
const beadPlateEl = document.getElementById('bead-plate');
const bigRoadEl = document.getElementById('big-road');
const historyBtn = document.getElementById('history-btn');
const historyModal = document.getElementById('history-modal');
const closeModalBtn = document.querySelector('.close-btn');
const historyTableBody = document.getElementById('history-table-body');
const deckCountEl = document.getElementById('deck-count-display');
const shoeIndicatorEl = document.getElementById('shoe-indicator');

let selectedChipValue = 10;
let myBets = {}; 
let isBettingPhase = false;

// --- Setup ---
selectDefaultChip();
setupEventListeners();
setupDragAndDrop();

function selectDefaultChip(){const d=document.querySelector('.chip[data-value="10"]');if(d){d.classList.add('selected');selectedChipValue=10}}

function setupEventListeners() {
    chipsContainer.addEventListener('click',(e)=>{if(e.target.classList.contains('chip')){document.querySelector('.chip.selected')?.classList.remove('selected');e.target.classList.add('selected');selectedChipValue=parseInt(e.target.dataset.value)}});
    bettingSpots.forEach(spot=>{spot.addEventListener('click',()=>{if(isBettingPhase)socket.emit('placeBet',{type:spot.dataset.betType,amount:selectedChipValue})})});
    clearBtn.addEventListener('click',()=>{if(isBettingPhase)socket.emit('clearBets');});
    rebetBtn.addEventListener('click', () => {if(isBettingPhase)socket.emit('rebet');});
    historyBtn.addEventListener('click', showHistoryModal);
    closeModalBtn.addEventListener('click', () => { historyModal.classList.add('hidden'); });
    historyModal.addEventListener('click', (e) => { if (e.target === historyModal) { historyModal.classList.add('hidden'); } });
}

function setupDragAndDrop() {
    let sourceBetType = null;

    bettingSpots.forEach(spot => {
        spot.addEventListener('dragover', (e) => {
            e.preventDefault(); 
        });

        spot.addEventListener('drop', (e) => {
            e.preventDefault();
            const target = e.currentTarget;
            target.classList.remove('drag-over');
            if (sourceBetType) {
                const targetBetType = target.dataset.betType;
                if (sourceBetType !== targetBetType) {
                    socket.emit('moveBet', { from: sourceBetType, to: targetBetType });
                }
                sourceBetType = null;
            }
        });

        spot.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        });
        spot.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('drag-over'));
    });

    window.makeChipsDraggable = (chipContainerElement) => {
        chipContainerElement.setAttribute('draggable', true);
        chipContainerElement.style.cursor = 'grab';
        chipContainerElement.addEventListener('dragstart', (e) => {
            sourceBetType = e.currentTarget.closest('.spot').dataset.betType;
            e.dataTransfer.setData('text/plain', sourceBetType);
            setTimeout(() => { e.currentTarget.classList.add('dragging'); }, 0);
        });
        chipContainerElement.addEventListener('dragend', (e) => {
            e.currentTarget.classList.remove('dragging');
            sourceBetType = null;
        });
    };
}

async function showHistoryModal() {
    try {
        const response = await fetch('/my-history');
        if (!response.ok) throw new Error('Failed to fetch');
        const historyData = await response.json();
        historyTableBody.innerHTML = '';
        historyData.forEach(row => {
            const tr = document.createElement('tr');
            const playerHand = JSON.parse(row.player_hand).map(c => c.value).join(', ');
            const bankerHand = JSON.parse(row.banker_hand).map(c => c.value).join(', ');
            let winLossAmount = row.winnings - row.amount;
            if (row.winnings === row.amount) winLossAmount = 0;
            const winLossClass = winLossAmount > 0 ? 'history-win' : (winLossAmount < 0 ? 'history-loss' : '');
            tr.innerHTML = `<td>${new Date(row.created_at).toLocaleTimeString('th-TH')}</td><td>${row.bet_type.replace(/_/g,' ').toUpperCase()}</td><td>${row.amount}</td><td>${row.winner.toUpperCase()}</td><td>${playerHand}</td><td>${bankerHand}</td><td class="${winLossClass}">${winLossAmount.toFixed(2)}</td>`;
            historyTableBody.appendChild(tr);
        });
        historyModal.classList.remove('hidden');
    } catch (error) {
        alert('ไม่สามารถโหลดประวัติได้');
    }
}

function updateButtonStates() {
    const hasMyBet = myBets.bets && Object.keys(myBets.bets).length > 0;
    clearBtn.classList.toggle('hidden', !hasMyBet);
    rebetBtn.classList.toggle('hidden', hasMyBet);
}

function updateTotalBetUI() {
    let total = 0;
    if (myBets.bets) total = Object.values(myBets.bets).reduce((sum, val) => sum + val, 0);
    totalBetEl.textContent = total;
}

function drawCardUI(handEl, card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card visible';
    if(card.suit==='♥'||card.suit==='♦')cardEl.style.color='red';
    cardEl.innerHTML = `<span>${card.value}</span><span>${card.suit}</span>`;
    handEl.appendChild(cardEl);
}

function showFloatingText(betType, amount) {
    const spot = document.querySelector(`.spot[data-bet-type="${betType}"]`);
    if (!spot) return;
    const floater = document.createElement('div');
    floater.className = 'payout-floater';
    floater.textContent = `+${amount.toFixed(2)}`;
    spot.appendChild(floater);
    floater.addEventListener('animationend', () => { floater.remove(); });
}

function updateChipsOnBoardUI(allBets){
    myBets=allBets[socket.id]||{};
    updateTotalBetUI();
    updateButtonStates();
    const d=[5000,1000,500,100,50,10];
    bettingSpots.forEach(spot=>{
        const bT=spot.dataset.betType;
        const pCC=spot.querySelector('.placed-chips');
        pCC.innerHTML='';
        pCC.setAttribute('draggable', false);
        pCC.style.cursor = 'default';
        let tAOS=0;
        for(const sId in allBets){
            if(allBets[sId].bets&&allBets[sId].bets[bT]) tAOS+=allBets[sId].bets[bT];
        }
        if(tAOS>0){
            let cI=0;let tA=tAOS;
            d.forEach(v=>{
                let count=Math.floor(tA/v);
                for(let i=0;i<count;i++){
                    const cE=document.createElement('div');cE.className=`chip board-chip`;
                    const sC=document.querySelector(`.chip[data-value="${v}"]`);
                    if(sC)cE.style.backgroundColor=window.getComputedStyle(sC).backgroundColor;
                    cE.style.bottom=`${cI*4}px`;pCC.appendChild(cE);cI++
                }
                tA%=v
            });
            const aD=document.createElement('div');aD.className='bet-amount-display';aD.textContent=tAOS;
            pCC.appendChild(aD);
            if (allBets[socket.id] && allBets[socket.id].bets[bT]) {
                window.makeChipsDraggable(pCC);
            }
        }
    })
}

function updateBeadPlateUI(h){beadPlateEl.innerHTML='';const beadPlateRows=6;h.forEach((result,index)=>{const cell=document.createElement('div');cell.className='bead-plate-cell';const colIndex=Math.floor(index/beadPlateRows);const rowIndex=index%beadPlateRows;cell.style.gridColumn=colIndex+1;cell.style.gridRow=rowIndex+1;if(result.winner==='player'){cell.classList.add('bead-player');cell.setAttribute('data-winner','P')}else if(result.winner==='banker'){cell.classList.add('bead-banker');cell.setAttribute('data-winner','B')}else{cell.classList.add('bead-tie');cell.setAttribute('data-winner','T')}beadPlateEl.appendChild(cell)})};
function updateBigRoadUI(bRD){bigRoadEl.innerHTML='';let col=0;bRD.forEach(column=>{let row=0;column.forEach(entry=>{const c=document.createElement('div');c.className='big-road-cell';c.style.gridColumn=col+1;c.style.gridRow=row+1;if(entry.winner==='player')c.classList.add('br-player');else c.classList.add('br-banker');if(entry.ties>0)c.classList.add('has-tie');bigRoadEl.appendChild(c);row++});col++})}
function setBettingPhase(enabled){isBettingPhase=enabled;chipsContainer.style.pointerEvents=enabled?'auto':'none';bettingSpots.forEach(spot=>spot.style.pointerEvents=enabled?'auto':'none');updateButtonStates();}
function processBigRoad(h){if(h.length===0)return[];const c=[[]];let l=null,t=0;h.forEach(r=>{if(r.winner==='tie'){t++;return}if(r.winner!==l){if(l!==null)c.push([]);l=r.winner}const C=c[c.length-1];C.push({winner:r.winner,ties:t});t=0});if(t>0&&c.length>0&&c[0].length>0){const L=c[c.length-1];if(L.length>0){const E=L[L.length-1];E.ties+=t}}return c} 

socket.on('init', ({ balance, username, history, deckCount, role }) => {
    balanceEl.textContent = balance.toFixed(2);
    document.getElementById('username-display').textContent = username;
    const bRD = processBigRoad(history);
    updateBeadPlateUI(history);
    updateBigRoadUI(bRD);
    deckCountEl.childNodes[0].nodeValue = `ไพ่: ${deckCount}`;
    shoeIndicatorEl.className = 'indicator-ok';
    if (role === 'admin') {
        document.getElementById('admin-btn-link').classList.remove('hidden');
    }
});

socket.on('balanceUpdate', (newBalance) => {balanceEl.textContent=newBalance.toFixed(2)});
socket.on('timerUpdate', ({ countdown, phase }) => {timerEl.textContent=countdown;timerEl.style.borderColor=countdown<=5?'red':'gold';if(phase==='BETTING'){messageEl.textContent=`วางเดิมพันใน ${countdown} วินาที!`;setBettingPhase(true)}});
socket.on('newRoundStarting', () => {playerHandEl.innerHTML='';bankerHandEl.innerHTML='';playerScoreEl.textContent='0';bankerScoreEl.textContent='0';myBets={};updateTotalBetUI();});
socket.on('cardDealt', (data) => {const hE=data.hand==='playerHand'?playerHandEl:bankerHandEl;const sE=data.hand==='playerHand'?playerScoreEl:bankerScoreEl;drawCardUI(hE,data.card);sE.textContent=data.score;deckCountEl.childNodes[0].nodeValue = `ไพ่: ${data.deckCount}`;});
socket.on('allBetsUpdate', (allBets) => {updateChipsOnBoardUI(allBets)});
socket.on('roundResult', ({ winner, winnings, balance, isLastHand, winningsBreakdown }) => {balanceEl.textContent=balance.toFixed(2);let msg='';if(winner==='tie')msg='เสมอ!';else msg=`${winner.charAt(0).toUpperCase()+winner.slice(1)} ชนะ!`;if(winnings>0)msg+=` คุณได้รับ ${winnings.toFixed(2)}!`;if(isLastHand)msg+=' (ตาสุดท้ายของกองไพ่)';messageEl.textContent=msg;if (winningsBreakdown) {winningsBreakdown.forEach(win => {showFloatingText(win.type, win.amount);});}});
socket.on('scoreboardUpdate', ({beadPlate, bigRoad}) => {updateBeadPlateUI(beadPlate);updateBigRoadUI(bigRoad);});
socket.on('dealingStarted', () => {messageEl.textContent='หมดเวลาเดิมพัน! กำลังแจกไพ่...';setBettingPhase(false)});
socket.on('cutCardShown', () => {messageEl.textContent='ไพ่ตัดกอง! ตานี้เป็นตาสุดท้ายของกองไพ่นี้';shoeIndicatorEl.className = 'indicator-warning';});
socket.on('shoeChange', ({ burnCard, numToBurn, burnedCards, deckCount }) => {messageEl.innerHTML=`กองไพ่ใหม่! <br> เบิร์นไพ่ใบแรกได้ ${burnCard.value}. ทิ้งไพ่ ${numToBurn} ใบ...`;deckCountEl.childNodes[0].nodeValue = `ไพ่: ${deckCount}`;shoeIndicatorEl.className = 'indicator-ok';});
socket.on('error', ({ message }) => {alert(message)});