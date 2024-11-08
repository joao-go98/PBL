import { createClient } from '@supabase/supabase-js'

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

// Create a debounce function to prevent rapid UI updates
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  const STATE = {
    balance: 0,
    bets: [],
    matches: [],
    userId: null,
    isLoading: true,
    liveUpdateIntervals: new Map() // Store intervals for live updates
  };

// Cache for team details to prevent unnecessary API calls
const teamDetailsCache = new Map();

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

async function fetchMatchScores(apiKey) {
  const response = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_portugal_primeira_liga/scores/?apiKey=${apiKey}&daysFrom=1`
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return await response.json();
}

async function getEnhancedMatchData(oddsApiKey, sportsDbApiKey) {
  try {
      const [matches, scores] = await Promise.all([
          fetchOdds(oddsApiKey),
          fetchMatchScores(oddsApiKey)
      ]);
      
      const enhancedMatches = await Promise.all(matches.map(async (match) => {
          const homeTeamDetails = await getTeamDetails(match.homeTeam, sportsDbApiKey);
          const awayTeamDetails = await getTeamDetails(match.awayTeam, sportsDbApiKey);
          
          match.setTeamDetails(homeTeamDetails, awayTeamDetails);
          
          // Update match with score information
          const matchScore = scores.find(s => s.id === match.id);
          if (matchScore) {
              match.setScores(matchScore);
          }
          
          return match;
      }));
      
      return enhancedMatches;
  } catch (error) {
      console.error('Error fetching enhanced match data:', error);
      throw error;
  }
}

function startLiveUpdates(match) {
  if (match.isLive && !STATE.liveUpdateIntervals.has(match.id)) {
      const intervalId = setInterval(async () => {
          try {
              const scores = await fetchMatchScores(import.meta.env.VITE_ODDS_API_KEY4);
              const matchScore = scores.find(s => s.id === match.id);
              
              if (matchScore) {
                  match.setScores(matchScore);
                  debouncedUpdateUI();
              }
              
              if (match.completed) {
                  clearInterval(intervalId);
                  STATE.liveUpdateIntervals.delete(match.id);
              }
          } catch (error) {
              console.error('Error updating live match:', error);
          }
      }, 60000); // Update every minute
      
      STATE.liveUpdateIntervals.set(match.id, intervalId);
  }
}

// Clean up intervals when page is unloaded
window.addEventListener('beforeunload', () => {
  STATE.liveUpdateIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
  });
});

async function initSimulatorWithEnhancedData() {
    try {
      STATE.isLoading = true;
      debouncedUpdateUI();
  
      const user = await checkAuth();
      if (!user) return;
      
      STATE.userId = user.id;
      
      const [userData, betsData] = await Promise.all([
        supabase.from('users').select('balance').eq('id', STATE.userId).single(),
        supabase.from('bets').select('*, home_team, away_team').eq('user_id', STATE.userId)
      ]);
      
      if (!userData.data) {
        throw new Error('User data not found');
      }
      
      STATE.balance = userData.data.balance;
      STATE.bets = betsData.data.map(betData => ({
        ...new Bet(betData.match_id, betData.type, betData.odds, betData.amount),
        id: betData.id,
        status: betData.status,
        home_team: betData.home_team,
        away_team: betData.away_team
      }));
      
      STATE.matches = await getEnhancedMatchData(
        import.meta.env.VITE_ODDS_API_KEY4,
        import.meta.env.VITE_SPORTS_API
      );
      
      STATE.isLoading = false;
      await debouncedUpdateUI();
      
    } catch (error) {
      console.error('Failed to initialize:', error);
      STATE.isLoading = false;
      document.querySelector('#matches').innerHTML = 
        '<p class="error">Failed to load matches. Please try again later.</p>';
    }
}

class Match {
  constructor(data) {
      this.id = data.id;
      this.homeTeam = data.home_team;
      this.awayTeam = data.away_team;
      this.startTime = new Date(data.commence_time);
      this.status = 'pending';
      this.odds = this.processOdds(data);
      this.bookmaker = data.bookmakers[0]?.title || 'Unknown';
      this.homeTeamDetails = null;
      this.awayTeamDetails = null;
      this.scores = data.scores || null;
      this.isLive = false;
      this.completed = false;
  }

  processOdds(data) {
      // Default odds in case processing fails
      const defaultOdds = { home: 2.0, draw: 3.0, away: 2.0 };
      
      try {
          // Get the first bookmaker's odds
          const bookmaker = data.bookmakers[0];
          if (!bookmaker) return defaultOdds;

          // Find the h2h (head to head) market
          const h2hMarket = bookmaker.markets.find(market => market.key === 'h2h');
          if (!h2hMarket) return defaultOdds;

          // Process the outcomes
          const oddsMap = {};
          h2hMarket.outcomes.forEach(outcome => {
              switch (outcome.name) {
                  case this.homeTeam:
                      oddsMap.home = outcome.price;
                      break;
                  case this.awayTeam:
                      oddsMap.away = outcome.price;
                      break;
                  case 'Draw':
                      oddsMap.draw = outcome.price;
                      break;
              }
          });

          // Return processed odds or default values for any missing odds
          return {
              home: oddsMap.home || defaultOdds.home,
              draw: oddsMap.draw || defaultOdds.draw,
              away: oddsMap.away || defaultOdds.away
          };
      } catch (error) {
          console.error('Error processing odds:', error);
          return defaultOdds;
      }
  }

  setTeamDetails(homeTeamDetails, awayTeamDetails) {
      this.homeTeamDetails = homeTeamDetails;
      this.awayTeamDetails = awayTeamDetails;
  }

  updateMatchStatus() {
      const now = new Date();
      if (this.completed) {
          this.status = 'completed';
      } else if (now >= this.startTime) {
          this.isLive = true;
          this.status = 'live';
      } else {
          this.isLive = false;
          this.status = 'pending';
      }
  }

  setScores(scoreInfo) {
      if (scoreInfo) {
          this.scores = scoreInfo.scores;
          this.completed = scoreInfo.completed;
          this.updateMatchStatus();
      }
  }
}

class Bet {
    constructor(matchId, type, odds, amount) {
        this.id = Date.now();
        this.matchId = matchId;
        this.type = type;
        this.odds = odds;
        this.amount = amount;
        this.status = 'active';
        this.potentialWin = (odds * amount).toFixed(2);
    }

    settle(matchResult) {
        if (this.status !== 'active') return 0;
        const won = this.type === matchResult;
        this.status = won ? 'won' : 'lost';
        return won ? parseFloat(this.potentialWin) : 0;
    }
}

async function fetchOdds(apiKey) {
    const baseUrl = 'https://api.the-odds-api.com/v4/sports/soccer_portugal_primeira_liga/odds/';
    const params = new URLSearchParams({
        apiKey,
        regions: 'eu',
        markets: 'h2h',
        oddsFormat: 'decimal'
    });

    const response = await fetch(`${baseUrl}?${params}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.map(match => new Match(match));
}

async function checkAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
        window.location.href = 'auth/login.html';
        return null;
    }
    
    return user;
}

// Consolidated updateUI function
async function updateUI() {
    document.querySelector('#balance').textContent = STATE.balance.toFixed(2);
    displayMatches();
    displayBets();
}

const debouncedUpdateUI = debounce(updateUI, 100);

function displayMatches() {
  const matchesContainer = document.querySelector('#matches');
  if (!matchesContainer) return;

  if (STATE.isLoading) {
      matchesContainer.innerHTML = '<div class="loading">Loading matches...</div>';
      return;
  }

  const fragment = document.createDocumentFragment();
  const now = new Date();

  STATE.matches.forEach(match => {
      const bettingDisabled = STATE.bets.some(bet => bet.matchId === match.id && bet.status === 'active') || 
                             now >= match.startTime;
      
      // Start live updates if match is live
      if (match.isLive) {
          startLiveUpdates(match);
      }
      
      const matchCard = document.createElement('div');
      matchCard.className = 'match-card';
      matchCard.dataset.matchId = match.id;
      
      // Add click handler for the entire card
      matchCard.addEventListener('click', (e) => {
          if (!e.target.classList.contains('bet-button')) {
              window.location.href = `match-details.html?id=${match.id}`;
          }
      });

      const getMatchStatus = () => {
          if (match.completed) return 'Final';
          if (match.isLive) return 'Live';
          return 'Upcoming';
      };

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
      
      matchCard.innerHTML = `
          <div class="match-header">
              <div class="team home-team">
                  <img src="${match.homeTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                       alt="${match.homeTeam}" 
                       class="team-badge"
                       loading="lazy"
                       onerror="this.src='/placeholder-badge.png'">
                  <h3>${match.homeTeamDetails?.strTeam || match.homeTeam}</h3>
              </div>
              
              <div class="match-info">
                  <div class="match-status ${match.isLive ? 'live' : ''}">${getMatchStatus()}</div>
                  ${getScoreDisplay()}
                  <div class="match-time">
                      ${new Date(match.startTime).toLocaleString()}
                  </div>
                  <div class="venue">
                      ${match.homeTeamDetails?.strStadium || 'Venue TBD'}
                  </div>
              </div>
              
              <div class="team away-team">
                  <img src="${match.awayTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                       alt="${match.awayTeam}" 
                       class="team-badge"
                       loading="lazy"
                       onerror="this.src='/placeholder-badge.png'">
                  <h3>${match.awayTeamDetails?.strTeam || match.awayTeam}</h3>
              </div>
          </div>
          
          <div class="odds-container">
              ${['home', 'draw', 'away'].map(type => `
                  <button class="bet-button ${bettingDisabled ? 'disabled' : ''}" 
                          data-match-id="${match.id}" 
                          data-type="${type}" 
                          data-odds="${match.odds[type]}"
                          ${bettingDisabled ? 'disabled' : ''}>
                      ${type.charAt(0).toUpperCase() + type.slice(1)} (${match.odds[type]})
                  </button>
              `).join('')}
          </div>
      `;

      // Add styles for live match status
      const style = document.createElement('style');
      style.textContent = `
          .match-status {
              position: relative;
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
      `;
      document.head.appendChild(style);
      
      fragment.appendChild(matchCard);
  });

  matchesContainer.innerHTML = '';
  matchesContainer.appendChild(fragment);

  matchesContainer.querySelectorAll('.bet-button:not(.disabled)').forEach(btn => 
      btn.addEventListener('click', handleBetClick));
}

function displayBets() {
  const betsContainer = document.querySelector('#bets');
  if (!betsContainer) return;

  betsContainer.innerHTML = STATE.bets.map(bet => {
      return `
          <div class="bet-item ${bet.status}" onclick="window.location.href='bet-details.html?id=${bet.id}'">
              <div>${bet.home_team} vs ${bet.away_team}</div>
              <div>${bet.type} @ ${bet.odds}</div>
              <div>€${bet.amount} - Status: ${bet.status}</div>
          </div>
      `;
  }).join('');
}

async function handleBetClick(event) {
    const { matchId, type, odds } = event.currentTarget.dataset;
    
    const amount = parseFloat(prompt('Enter bet amount (€):'));
    
    if (!amount || amount <= 0 || amount > STATE.balance) {
        alert('Invalid bet amount or insufficient balance');
        return;
    }

    await placeBet(matchId, type, parseFloat(odds), amount);
}

async function placeBet(matchId, type, odds, amount) {
    try {
        let betTypes
        const match = STATE.matches.find(m => m.id === matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        const newBalance = STATE.balance - amount;
        await supabase.from('users').update({ balance: newBalance }).eq('id', STATE.userId);
        
        const bet = new Bet(matchId, type, odds, amount);
        if(bet.type === "home")
        {
          betTypes = "home_win"
        }
        if(bet.type === "away")
        {
          betTypes = "away_win"
        }
        await supabase.from('bets').insert([{
            id: bet.id,
            user_id: STATE.userId,
            match_id: bet.matchId,
            type: betTypes,
            odds: bet.odds,
            amount: bet.amount,
            status: bet.status,
            potential_win: bet.potentialWin,
            home_team: match.homeTeamDetails?.strTeam || match.homeTeam,
            away_team: match.awayTeamDetails?.strTeam || match.awayTeam
        }]);
        
        STATE.balance = newBalance;
        STATE.bets.push({
            ...bet,
            home_team: match.homeTeamDetails?.strTeam || match.homeTeam,
            away_team: match.awayTeamDetails?.strTeam || match.awayTeam
        });
        await updateUI();
    } catch (error) {
        console.error('Error placing bet:', error);
        alert('Failed to place bet');
    }
}

document.getElementById('logout-button').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'auth/login.html';
});

document.addEventListener('DOMContentLoaded', initSimulatorWithEnhancedData);

export { initSimulatorWithEnhancedData, getEnhancedMatchData, STATE };
