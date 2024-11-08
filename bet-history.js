import { createClient } from '@supabase/supabase-js'

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const STATE = {
    bets: [],
    userId: null,
    isLoading: true,
    statusFilter: 'all',
    typeFilter: 'all'
};

// Team name mappings (reused from simulator.js)
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

// Cache for team details
const teamDetailsCache = new Map();

async function checkAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
        window.location.href = '/login.html';
        return null;
    }
    
    return user;
}

async function fetchMatchResult(matchId, apiKey) {
    const scoresUrl = 'https://api.the-odds-api.com/v4/sports/soccer_portugal_primeira_liga/scores/';
    const params = new URLSearchParams({
        apiKey,
        daysFrom: 1,
        dateFormat: 'iso'
    });

    try {
        const response = await fetch(`${scoresUrl}?${params}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const matches = await response.json();
        
        const match = matches.find(m => m.id === matchId);
        
        if (match && match.completed) {
            // Ensure we're correctly interpreting the scores array
            const homeTeamScore = parseInt(match.scores[0].score);
            const awayTeamScore = parseInt(match.scores[1].score);
            
            return {
                completed: true,
                homeScore: homeTeamScore,
                awayScore: awayTeamScore,
                winner: homeTeamScore > awayTeamScore ? 'home_win' :
                        awayTeamScore > homeTeamScore ? 'away_win' : 'draw'
            };
        }
        
        return { completed: false };
    } catch (error) {
        console.error('Error fetching match result:', error);
        throw error;
    }
}

async function processBetPayout(bet) {
    try {
        if (bet.status !== 'active') {
            console.log('Bet Status:', bet.status, '- Skipping non-active bet');
            return;
        }

        console.log('\n=== Processing Bet Payout ===');
        console.log('Bet ID:', bet.id);
        console.log('Match ID:', bet.match_id);
        console.log('Bet Type:', bet.type);
        console.log('Current Status:', bet.status);

        const matchResult = await fetchMatchResult(bet.match_id, import.meta.env.VITE_ODDS_API_KEY4);
        
        if (matchResult.completed) {
            console.log('\nAPI Match Result:', {
                completed: matchResult.completed,
                homeScore: matchResult.homeScore,
                awayScore: matchResult.awayScore,
                winner: matchResult.winner
            });
            
            // Compare bet type directly with match result winner
            const betWon = bet.type === matchResult.winner;
            console.log('\nComparison:', {
                'Bet Type': bet.type,
                'Match Winner': matchResult.winner,
                'Result Matches?': betWon
            });

            const potentialWin = bet.amount * bet.odds;
            console.log('Potential Win:', potentialWin);
            console.log('New Status:', betWon ? 'won' : 'lost');

            // Update bet status only
            await supabase
                .from('bets')
                .update({ 
                    status: betWon ? 'won' : 'lost'
                })
                .eq('id', bet.id);

            // Only update balance if bet was won
            if (betWon) {
                const { data: userData } = await supabase
                    .from('users')
                    .select('balance')
                    .eq('id', STATE.userId)
                    .single();

                const newBalance = userData.balance + potentialWin;
                console.log('\nBalance Update:', {
                    'Old Balance': userData.balance,
                    'Win Amount': potentialWin,
                    'New Balance': newBalance
                });
                
                await supabase
                    .from('users')
                    .update({ balance: newBalance })
                    .eq('id', STATE.userId);
            }

            return { betWon, potentialWin, matchResult };
        } else {
            console.log('Match not completed yet');
        }
        
        return null;
    } catch (error) {
        console.error('Error processing bet payout:', error);
        throw error;
    }
}

async function validateBetResults(bet) {
    try {
        console.log('\n=== Validating Bet Results ===');
        console.log('Bet ID:', bet.id);
        console.log('Match ID:', bet.match_id);
        console.log('Current Status:', bet.status);
        console.log('Bet Type:', bet.type);

        const matchResult = await fetchMatchResult(bet.match_id, import.meta.env.VITE_ODDS_API_KEY4);
        
        if (!matchResult.completed) {
            console.log('Match not completed yet');
            return {
                validated: false,
                message: 'Match not yet completed'
            };
        }

        console.log('\nAPI Match Result:', {
            completed: matchResult.completed,
            homeScore: matchResult.homeScore,
            awayScore: matchResult.awayScore,
            winner: matchResult.winner
        });

        // Compare bet type directly with match result winner
        const shouldHaveWon = bet.type === matchResult.winner;
        const databaseStatus = bet.status;

        console.log('\nValidation Check:', {
            'Bet Type': bet.type,
            'Match Winner': matchResult.winner,
            //'Should Have Won?': shouldHaveWon,
            'Database Status': databaseStatus,
            'Status Correct?': shouldHaveWon
        });

        console.log("o estado correto desta aposta é ", shouldHaveWon)
        
              
        return {
            validated: true,
            actualResult: matchResult,
            databaseStatus: databaseStatus,
            correctStatus: shouldHaveWon ? 'won' : 'lost',
        };
    } catch (error) {
        console.error('Error validating bet result:', error);
        throw error;
    }
}

function getUniqueBetTypes(bets) {
    return ['all', ...new Set(bets.map(bet => bet.type))];
}

function createFilterButtons(container) {
    const filterContainer = document.createElement('div');
    filterContainer.className = 'filters-container';
    
    // Status filters
    const statusFilters = document.createElement('div');
    statusFilters.className = 'status-filters';
    
    ['all', 'active', 'won', 'lost'].forEach(status => {
        const button = document.createElement('button');
        button.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        button.className = `filter-button status-filter ${STATE.statusFilter === status ? 'active' : ''}`;
        button.onclick = () => {
            STATE.statusFilter = status;
            updateUI();
        };
        statusFilters.appendChild(button);
    });

    // Type filters
    const typeFilters = document.createElement('div');
    typeFilters.className = 'type-filters';
    
    const betTypes = getUniqueBetTypes(STATE.bets);
    betTypes.forEach(type => {
        const button = document.createElement('button');
        button.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        button.className = `filter-button type-filter ${STATE.typeFilter === type ? 'active' : ''}`;
        button.onclick = () => {
            STATE.typeFilter = type;
            updateUI();
        };
        typeFilters.appendChild(button);
    });

    filterContainer.appendChild(statusFilters);
    filterContainer.appendChild(typeFilters);
    container.insertBefore(filterContainer, container.firstChild);
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

function updateUI() {
    const container = document.querySelector('#bets-container');
    
    if (STATE.isLoading) {
        container.innerHTML = '<div class="loading">Loading bets...</div>';
        return;
    }

    if (!STATE.bets || STATE.bets.length === 0) {
        container.innerHTML = '<p>No bets found.</p>';
        return;
    }

    // Filter bets based on current state
    const filteredBets = STATE.bets.filter(bet => {
        const matchesStatus = STATE.statusFilter === 'all' || bet.status === STATE.statusFilter;
        const matchesType = STATE.typeFilter === 'all' || bet.type === STATE.typeFilter;
        return matchesStatus && matchesType;
    });

    // Clear container and add filter buttons
    container.innerHTML = '';
    createFilterButtons(container);

    const betsContainer = document.createElement('div');
    betsContainer.className = 'bets-container';

    // Create and append each bet card
    filteredBets.forEach(bet => {
        const betCard = document.createElement('div');
        betCard.className = `bet-item ${bet.status}`;
        
        const potentialWin = bet.amount * bet.odds;
        
        betCard.innerHTML = `
            <div class="match-header">
                <div class="team home-team">
                    <img src="${bet.homeTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                         alt="${bet.home_team}" 
                         class="team-badge"
                         loading="lazy"
                         onerror="this.src='/placeholder-badge.png'">
                    <h3>${bet.homeTeamDetails?.strTeam || bet.home_team}</h3>
                </div>
                
                <div class="match-info">
                    <div class="bet-status ${bet.status}">
                        ${bet.status.toUpperCase()}
                    </div>
                    <div class="match-score">
                        <span class="home-score">${bet.home_team_score || 0}</span>
                        <span class="score-separator">-</span>
                        <span class="away-score">${bet.away_team_score || 0}</span>
                    </div>
                    <div class="bet-details">
                        <p>Type: ${bet.type}</p>
                        <p>Amount: €${bet.amount.toFixed(2)}</p>
                        <p>Odds: ${bet.odds}</p>
                        <p>Odds: ${bet.home_team_score}</p>
                        <p>Odds: ${bet.away_team_score}</p>
                        ${bet.status === 'won' ? 
                            `<p class="payout">Won: €${potentialWin.toFixed(2)}</p>` : 
                            `<p>Potential Win: €${potentialWin.toFixed(2)}</p>`}
                    </div>
                </div>
                
                <div class="team away-team">
                    <img src="${bet.awayTeamDetails?.strBadge || '/placeholder-badge.png'}" 
                         alt="${bet.away_team}" 
                         class="team-badge"
                         loading="lazy"
                         onerror="this.src='/placeholder-badge.png'">
                    <h3>${bet.awayTeamDetails?.strTeam || bet.away_team}</h3>
                </div>
            </div>
        `;
        
        betsContainer.appendChild(betCard);
    });

    container.appendChild(betsContainer);

    // Add styles
    const styleElement = document.getElementById('dynamic-styles') || document.createElement('style');
    styleElement.id = 'dynamic-styles';
    styleElement.textContent = `
        .bet-item {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 1rem;
            padding: 1rem;
            transition: transform 0.2s;
        }
        
        .bet-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        .match-header {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 1rem;
            align-items: center;
        }
        
        .team {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        
        .team-badge {
            width: 60px;
            height: 60px;
            object-fit: contain;
            margin-bottom: 0.5rem;
        }
        
        .match-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
        }
        
        .match-score {
            font-size: 1.5rem;
            font-weight: bold;
        }
        
        .score-separator {
            margin: 0 0.5rem;
        }
        
        .bet-status {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 0.875rem;
        }
        
        .bet-status.active {
            background: #ffd700;
            color: #000;
        }
        
        .bet-status.won {
            background: #4caf50;
            color: white;
        }
        
        .bet-status.lost {
            background: #f44336;
            color: white;
        }
        
        .bet-details {
            text-align: center;
            margin-top: 1rem;
        }
        
        .payout {
            color: #4caf50;
            font-weight: bold;
        }
        
        @media (max-width: 768px) {
            .match-header {
                grid-template-columns: 1fr;
                gap: 0.5rem;
            }
            
            .team-badge {
                width: 40px;
                height: 40px;
            }
        }
    `;
    
    if (!styleElement.parentNode) {
        document.head.appendChild(styleElement);
    }
}

async function initBetHistory() {
    try {
        STATE.isLoading = true;
        updateUI();

        const user = await checkAuth();
        if (!user) return;
        
        STATE.userId = user.id;

        // Fetch all bets for the user
        const { data: betsData, error: betsError } = await supabase
            .from('bets')
            .select('*')
            .eq('user_id', STATE.userId);

        if (betsError) throw betsError;

        // Enhance bets with team details and scores
        STATE.bets = await Promise.all(betsData.map(async bet => {
            // Get team details, caching them to avoid duplicate calls
            const homeTeamDetails = await getTeamDetails(bet.home_team, import.meta.env.VITE_SPORTS_API);
            const awayTeamDetails = await getTeamDetails(bet.away_team, import.meta.env.VITE_SPORTS_API);

            let homeScore = bet.home_team_score;
            let awayScore = bet.away_team_score;
            let matchResult = null;

            // Check if scores are null, if so, fetch from API
            if (homeScore === null || awayScore === null) {
                matchResult = await fetchMatchResult(bet.match_id, import.meta.env.VITE_ODDS_API_KEY4);
                if (matchResult.completed) {
                    homeScore = matchResult.homeScore;
                    awayScore = matchResult.awayScore;

                    // Update the database with the fetched scores
                    await supabase
                        .from('bets')
                        .update({ 
                            home_team_score: homeScore,
                            away_team_score: awayScore
                        })
                        .eq('id', bet.id);
                }
            }

            return {
                ...bet,
                homeTeamDetails,
                awayTeamDetails,
                matchResult,
                home_team_score: homeScore,
                away_team_score: awayScore
            };
        }));

        STATE.isLoading = false;
        updateUI();

    } catch (error) {
        console.error('Failed to initialize bet history:', error);
        STATE.isLoading = false;
        document.querySelector('#bets-container').innerHTML = 
            '<p class="error">Failed to load bets. Please try again later.</p>';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initBetHistory);