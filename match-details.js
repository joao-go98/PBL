import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

// Team name mappings for translation between APIs
const TEAM_NAME_MAPPINGS = {
    "Sporting Lisbon": "Sporting_CP",
    "FC Porto": "FC_Porto",
    "Benfica": "Benfica",
    "Braga": "Braga",
    "Vitória SC": "Guimaraes",
    "Famalicao": "Famalicao",
    "Moreirense FC": "Moreirense",
    "Casa Pia": "Casa_Pia",
    "Boavista Porto": "Boavista",
    "Rio Ave FC": "Rio_Ave",
    "Gil Vicente": "Gil_Vicente",
    "Farense": "SC_Farense",
    "CF Estrela": "Estrela_Amadora",
    "Vizela": "FC_Vizela",
    "Portimonense": "Portimonense",
    "Chaves": "Chaves",
    "Estoril": "Estoril-Praia",
    "Arouca": "Arouca",
    "Nacional": "CD_Nacional_de_Madeira"
};

// Cache for team details to prevent unnecessary API calls
const teamDetailsCache = new Map();

let STATE = {
    match: null,
    userBets: [],
    balance: 0,
    userId: null
};

async function checkAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
        window.location.href = '/auth/login.html';
        return null;
    }
    
    return user;
}

async function getTeamDetails(teamName, apiKey) {
    if (teamDetailsCache.has(teamName)) {
        return teamDetailsCache.get(teamName);
    }

    try {
        const translatedName = TEAM_NAME_MAPPINGS[teamName] || teamName.replace(/ /g, '_');
        const response = await fetch(
            `https://www.thesportsdb.com/api/v1/json/${apiKey}/searchteams.php?t=${translatedName}`
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const teamDetails = data.teams ? data.teams[0] : null;

        teamDetailsCache.set(teamName, teamDetails);
        return teamDetails;
    } catch (error) {
        console.error(`Error fetching details for team ${teamName}:`, error);
        return null;
    }
}

async function getMatchDetails(matchId) {
    const oddsApiKey = import.meta.env.VITE_ODDS_API_KEY4;
    const sportsDbApiKey = import.meta.env.VITE_SPORTS_API;
    
    // Fetch both odds and scores in parallel
    const [oddsResponse, scoresResponse] = await Promise.all([
        fetch(
            `https://api.the-odds-api.com/v4/sports/soccer_portugal_primeira_liga/odds/?apiKey=${oddsApiKey}&regions=eu&markets=h2h&oddsFormat=decimal`
        ),
        fetch(
            `https://api.the-odds-api.com/v4/sports/soccer_portugal_primeira_liga/scores/?apiKey=${oddsApiKey}&daysFrom=1`
        )
    ]);
    
    if (!oddsResponse.ok || !scoresResponse.ok) 
        throw new Error('Failed to fetch match data');
    
    const [matches, scores] = await Promise.all([
        oddsResponse.json(),
        scoresResponse.json()
    ]);

    const match = matches.find(m => m.id === matchId);
    const scoreInfo = scores.find(s => s.id === matchId);
    
    if (match) {
        // Fetch team details in parallel
        const [homeTeamDetails, awayTeamDetails] = await Promise.all([
            getTeamDetails(match.home_team, sportsDbApiKey),
            getTeamDetails(match.away_team, sportsDbApiKey)
        ]);

        return {
            ...match,
            homeTeamDetails,
            awayTeamDetails,
            scoreInfo: scoreInfo || null,
            isLive: scoreInfo?.completed === false && scoreInfo?.commence_time < new Date().toISOString(),
            scores: scoreInfo?.scores || null
        };
    }
    
    return null;
}

async function loadMatchDetails() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const matchId = urlParams.get('id');
        
        if (!matchId) {
            throw new Error('No match ID provided');
        }
        
        const user = await checkAuth();
        if (!user) return;
        
        STATE.userId = user.id;
        
        // Fetch match data and user data in parallel
        const [matchData, userData, betsData] = await Promise.all([
            getMatchDetails(matchId),
            supabase.from('users').select('balance').eq('id', user.id).single(),
            supabase.from('bets').select('*').eq('match_id', matchId).eq('user_id', user.id)
        ]);
        
        if (!matchData) {
            throw new Error('Match not found');
        }
        
        STATE.match = matchData;
        STATE.balance = userData.data.balance;
        STATE.userBets = betsData.data;
        
        updateUI();
        
    } catch (error) {
        console.error('Error loading match details:', error);
        document.getElementById('match-details').innerHTML = 
            '<div class="error">Failed to load match details. Please try again later.</div>';
    }
}

function updateUI() {
    const match = STATE.match;
    document.getElementById('balance').textContent = STATE.balance.toFixed(2);
    
    // Helper function to get match status display
    const getMatchStatus = () => {
        if (match.scoreInfo?.completed) return 'Final';
        if (match.isLive) return 'Live';
        return 'Upcoming';
    };

    // Helper function to get score display
    const getScoreDisplay = () => {
        if (!match.scores) return '';
        return `
            <div class="match-score">
                <span class="home-score">${match.scores[0]?.score || 0}</span>
                <span class="score-separator">-</span>
                <span class="away-score">${match.scores[1]?.score || 0}</span>
            </div>
        `;
    };

    // Update match details section with status and score
    const matchDetailsHtml = `
        <div class="match-header">
            <div class="team home">
                <img src="${match.homeTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                     alt="${match.home_team}" class="team-badge"
                     onerror="this.src='/placeholder-badge.png'">
                <h2>${match.homeTeamDetails?.strTeam || match.home_team}</h2>
            </div>
            
            <div class="match-info">
                <div class="match-status ${match.isLive ? 'live' : ''}">${getMatchStatus()}</div>
                ${getScoreDisplay()}
                <div class="match-time">${new Date(match.commence_time).toLocaleString()}</div>
                <div class="venue">${match.homeTeamDetails?.strStadium || 'Venue TBD'}</div>
            </div>
            
            <div class="team away">
                <img src="${match.awayTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                     alt="${match.away_team}" class="team-badge"
                     onerror="this.src='/placeholder-badge.png'">
                <h2>${match.awayTeamDetails?.strTeam || match.away_team}</h2>
            </div>
        </div>

        <style>
            .match-status {
                font-weight: bold;
                padding: 4px 8px;
                border-radius: 4px;
                margin-bottom: 8px;
            }
            
            .match-status.live {
                position: relative;
                background-color: #ff4444;
                color: white;
                animation: pulse 2s infinite;
            }
            
            .match-score {
                font-size: 2em;
                font-weight: bold;
                margin: 10px 0;
            }
            
            .score-separator {
                margin: 0 10px;
            }
            
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.7; }
                100% { opacity: 1; }
            }
        </style>
    `;
    document.getElementById('match-details').innerHTML = matchDetailsHtml;

    // Update betting options
    const bettingOptionsHtml = `
        <div class="odds-grid">
            ${match.bookmakers[0].markets[0].outcomes.map(outcome => `
                <div class="odds-cell">
                    <button class="bet-button" 
                            data-type="${outcome.name === 'Draw' ? 'draw' : outcome.name === match.home_team ? 'home' : 'away'}"
                            data-odds="${outcome.price}"
                            ${isMatchLocked() ? 'disabled' : ''}>
                        ${outcome.name} (${outcome.price})
                    </button>
                </div>
            `).join('')}
        </div>
    `;
    document.getElementById('betting-options').innerHTML = bettingOptionsHtml;
    
    // Update team stats
    if (match.homeTeamDetails) {
        document.getElementById('home-team-stats').innerHTML = generateTeamStats(match.homeTeamDetails);
    }
    if (match.awayTeamDetails) {
        document.getElementById('away-team-stats').innerHTML = generateTeamStats(match.awayTeamDetails);
    }
    
    // Update user's bets for this match
    const matchBetsHtml = STATE.userBets.length ? 
        STATE.userBets.map(bet => `
            <div class="bet-item ${bet.status}">
                <div class="bet-type">${bet.type}</div>
                <div class="bet-details">
                    <div>Amount: €${bet.amount}</div>
                    <div>Odds: ${bet.odds}</div>
                    <div>Potential Win: €${bet.potential_win}</div>
                </div>
                <div class="bet-status">Status: ${bet.status}</div>
            </div>
        `).join('') :
        '<p>No bets placed on this match yet.</p>';
    
    document.getElementById('match-bets').innerHTML = matchBetsHtml;
    
    // Add event listeners to betting buttons
    document.querySelectorAll('.bet-button:not([disabled])').forEach(btn => {
        btn.addEventListener('click', handleBetClick);
    });
}

function generateTeamStats(teamDetails) {
    return `
        <div class="team-stat">
            <label>Founded:</label>
            <span>${teamDetails.intFormedYear || 'N/A'}</span>
        </div>
        <div class="team-stat">
            <label>Stadium:</label>
            <span>${teamDetails.strStadium || 'N/A'}</span>
        </div>
        <div class="team-stat">
            <label>Capacity:</label>
            <span>${teamDetails.intStadiumCapacity || 'N/A'}</span>
        </div>
    `;
}

function isMatchLocked() {
    return new Date() >= new Date(STATE.match.commence_time) || 
           STATE.userBets.some(bet => bet.status === 'active');
}

function startLiveUpdates() {
    if (STATE.match?.isLive) {
        // Refresh every 60 seconds for live matches
        const intervalId = setInterval(async () => {
            try {
                const updatedMatch = await getMatchDetails(STATE.match.id);
                if (updatedMatch) {
                    STATE.match = updatedMatch;
                    updateUI();
                }
                
                // Stop updating if match is completed
                if (updatedMatch?.scoreInfo?.completed) {
                    clearInterval(intervalId);
                }
            } catch (error) {
                console.error('Error updating live match:', error);
            }
        }, 60000);

        // Store interval ID to clear it when needed
        STATE.liveUpdateInterval = intervalId;
    }
}

// Clean up interval when page is unloaded
window.addEventListener('beforeunload', () => {
    if (STATE.liveUpdateInterval) {
        clearInterval(STATE.liveUpdateInterval);
    }
});


async function handleBetClick(event) {
    const button = event.currentTarget;
    const type = button.dataset.type;
    const odds = parseFloat(button.dataset.odds);
    
    const amount = parseFloat(prompt('Enter bet amount (€):'));
    
    if (!amount || amount <= 0 || amount > STATE.balance) {
        alert('Invalid bet amount or insufficient balance');
        return;
    }
    
    try {
        const newBalance = STATE.balance - amount;
        await supabase.from('users').update({ balance: newBalance }).eq('id', STATE.userId);
        
        const bet = {
            id: Date.now(),
            user_id: STATE.userId,
            match_id: STATE.match.id,
            type,
            odds,
            amount,
            status: 'active',
            potential_win: (odds * amount).toFixed(2),
            home_team: STATE.match.homeTeamDetails?.strTeam || STATE.match.home_team,
            away_team: STATE.match.awayTeamDetails?.strTeam || STATE.match.away_team
        };
        
        await supabase.from('bets').insert([bet]);
        
        STATE.balance = newBalance;
        STATE.userBets.push(bet);
        
        updateUI();
    } catch (error) {
        console.error('Error placing bet:', error);
        alert('Failed to place bet');
    }
}

document.getElementById('logout-button').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth/login.html';
});

document.addEventListener('DOMContentLoaded', loadMatchDetails);