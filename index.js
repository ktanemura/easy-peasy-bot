/**
 * A Bot for Slack!
 */


/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({ user: installer }, function(err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}


/**
 * Configure the persistence options
 */

var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({ mongoUri: process.env.MONGOLAB_URI }),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN) ? './db_slack_bot_ci/' : './db_slack_bot_a/'), //use a different name if an app or CI
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */

var controller;

if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    controller = customIntegration.configure(token, config, onInstallation);
} else {//if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    // controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
    controller = app.configure(7700, "456099323280.456110067536", "5d44344e20725effa9dc2d1d0db0d535", config, onInstallation);
} /*else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}*/


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function() {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function() {
    console.log('** The RTM api just closed');
    process.exit(1);
    // you may want to attempt to re-open
});


/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!
let games = {};
let game_id = 1;
let pad = '0000';
let players = {};
let game_stats = {
    total: 0,
    exact: 0,
    wilds: 0,
    complete: 0,
    num_dice: {}
};
var f = [];
var jsonfile = require('jsonfile');
var Random = require('random-js');
var random = new Random(Random.engines.mt19937().autoSeed());
jsonfile.readFile(__dirname + '/game_storage.json')
    .then(obj => {
        if (obj.game_id) {
            game_id = obj.game_id;
        }

        if (obj.players) {
            players = obj.players;
        }

        if (obj.game_stats) {
            game_stats = obj.game_stats;
        }
    })
    .catch(err => {
        console.log("ERROR FILE INIT", err);
    });

function factorial(n) {
    if (n === 0 || n === 1) {
        return 1;
    } else if (f[n] > 0) {
        return f[n];
    }

    f[n] = factorial(n - 1) * n;
    return f[n];
}

function combinations(n, k) {
    let nm = factorial(n);
    let dm = factorial(k) * factorial((n - k));

    return nm / dm;
}

function blindProbability(total, amount, exact, wilds, value) {
    let pT = 0;
    let p;
    let validFaces = wilds && value !== 1 ? 2 : 1;
    let a;
    let b;
    for (let i = amount; i <= total; i++) {
        a = validFaces / 6;
        b = (6 - validFaces) / 6;
        p = Math.pow(a, i) * Math.pow(b, total - i) * combinations(total, i);
        pT += p;

        if (exact) {
            break;
        }
    }

    return Math.floor(pT * 10000) / 100;
}

function rollAllDice(game, bot, message) {
    for (let k in game.members) {
        let roll = random.dice(6, game.members[k].dice);
        let m = {
            user: k,
            channel: message.channel,
            thread_ts: message.thread_ts
        };

        // for (let i = 0; i < game.members[k].dice; i++) {
        //     roll.push(rollDice(1, 6));
        // }
        game.members[k].roll = roll;
        // bot.startPrivateConversation(m, function(err, convo) {
        //     convo.say(`You rolled ${games[message.thread_ts].members[convo.source_message.user].roll.length} dice for game ${games[message.thread_ts].gid}: ${games[message.thread_ts].members[convo.source_message.user].roll}`);
        // });
        bot.whisper(m, `You rolled ${roll.length} dice for game ${game.gid}: ${roll}`);
    }
}

function checkWinner(game, winner, loser, bot, message, s) {
    if (Object.keys(game.members).length === 1) {
        for (let i = 0; i < game.players.length; i++) {
            if (!players[game.players[i]]) {
                players[game.players[i]] = {
                    wins: 0,
                    losses: 0,
                    smugs: 0
                };
            }

            if (game.players[i] === winner) {
                players[game.players[i]].wins++;
            } else {
                players[game.players[i]].losses++;
            }

        }

        players[winner].smugs += game.members[winner].smugs;
        game_stats.complete++;

        let toStore = {
            game_id: game_id,
            players: players,
            game_stats: game_stats
        };

        jsonfile.writeFile(__dirname + '/game_storage.json', toStore)
            .then(() => {
                console.log("FILE UPDATED");
            })
            .catch(err => {
                console.log("ERROR UPDATING FILE", err);
            });

        bot.replyInThread(message, s + `<@${winner}> has won the game! Their win total is now ${players[winner].wins}, congratulations! This game has now concluded, please start a new game to play again.`);
    } else {
        let found = false;
        rollAllDice(game, bot, message);
        while (!game.members[game.players[game.currentPlayer]] || !found) {
            if (game.players[game.currentPlayer] === loser) {
                found = true;
            }

            game.currentPlayer++;
            game.currentPlayer = game.currentPlayer < game.players.length ? game.currentPlayer : 0;
        }
        s += `<@${game.players[game.currentPlayer]}> It is your turn to bet! There are ${game.totalDice} dice left.`;
        bot.replyInThread(message, s);
    }
}

function getCommands() {
    let s = `
    To run a command you must mention the but (@liars_dice_bot) with the appropriate command string.\n
    (*) Commands do not have strict formatting\n
    ~~~~~~~~\n
    Top Level Commands (Made directly in channel):\n
    "new game [--exact] [--wildcards] [--numdice <num_dice>]" - Creates a new game with specified options (Flags are all optional)\n
    "rules" (*) - Display the rules of the game
    "help" (*) - Display this command list (Can be done in thread as well)\n
    ~~~~~~~~\n
    Game Commands (Must be made in game thread):\n
    "join game" (*) - Join the game running in the message thread\n
    "start game" (*) - Start the game in the thread (no more players can join)\n
    "bet <num_dice> <dice_value>" - Make a bet that there are at least num_dice of dice_value among all players\n
    "bs || liar" (*) - Challenge the last made bet (any player may call this)\n
    "exact" (*) - Call exact on the previous bet\n
    "check dice" - Will resend what you rolled in to the channel. If not in the current game (or eliminated) will whisper every players dice\n
    "prob amount" - Calculate the probability of the last bet being true\n
    "prob exactly" - Calculate the probability of the last bet being EXACTLY true\n
    "history" (*) - Show a history of the bets made in the current round\n
    "players" (*) - Show the current players (will show who's turn it is if game has started)\n
    `;
    return s;
}

function getRules() {
    let s = `
        Liar's dice is a class of dice games for two or more players requiring the ability to deceive and to detect an opponent's deception.\n
        ~~~~~~~~\n
        Base Rules:\n
        - A game consists of a number of rounds that have the following steps:
        1. All players roll a number of dice, keeping the rolled values a secret from the other players\n
        2. Players take ordered turns with two choices of action on their turn; making a higher bid or challenging the previous bid\n
        2A. Bids are a statement consisting of a face value of a die and the minimum number of dice rolled among all players showing that face (e.g. bidding "Three Sixes" means you are asserting that in total there are at least 3 dice that rolled a face of 6)\n
        2B. All bids (excluding the first bid of the round) must "up" the previous bid by bidding a higher quantity of any particular face, or the same quantity of a higher face (e.g. If the prvious bid was "Two Fours" the player may bid "Two Fives", Two Sixes", or three or more of any face)\n
        2C. A challenge is an assertation that the current bid is not correct and ends the bidding\n
        3. Once a player has challenged the current bid all players reveal their dice and they are counted to see if the challenged bid was correct\n
        3A. If the challeneged bid was correct, the challenger loses a die. If the challenged bid was incorrect, the bidder loses a die.
        3B. If the loser has no dice remaining they are eliminated from the game\n
        - Rounds are repeated until only one player (the winner) remains\n
        - While bidding must be done in order, any player can challenge a bid\n
        - The first player in the round must bid\n
        - The loser of the previous round begins the bidding for the next round\n
        - If the loser of the previous round was eliminated then the next non-eliminated player after them begins the next round\n
        ~~~~~~~\n
        Bonus Variants:\n
        - Wildcards: Face 1 of a die counts for every other face as well (e.g. Two 1s and Three 5s mean there are Five 5s)\n
        - Exact: A player can call 'exact' instead of challenging a bid. If the previous bid was exactly correct, the caller gains a dice. Loses a dice as a penalty if wrong (original bidder not punished)
    `;

    return s;
}

controller.on('bot_channel_join', function(bot, message) {
    bot.reply(message, getCommands());
});


controller.hears('kill game', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to kill a game.`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed.`);
    } else if (!games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You must be a member of the game to kill it.`);
    } else {
        delete games[message.thread_ts];
        bot.replyInThread(message, `<@${message.user}> Killed the game.`);
    }
});

controller.hears('new game', 'direct_mention', function(bot, message) {

    if (Object.keys(games).length > 4) {
        bot.replyInThread(message, `<@${message.user}> There are already 5 games being played. Kill or complete one to make room.`);
    } else if (message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You cannot start a game inside another thread!`);
    } else if (message.match.index === 0) {
        let cmd = message.text.split(" ");
        let new_game = {
            dice: 4,
            exact: false,
            wildcards: false,
            members: {},
            history: [],
            players: [],
            rollable: false,
            joinable: true,
            currentPlayer: ""
        };

        let s = "";
        for (let i = 2; i < cmd.length; i++) {
            switch (cmd[i]) {
            case "--exact":
                new_game.exact = true;
                game_stats.exact++;
                s += "Exact command is enabled for this game.\n";
                break;

            case "--wildcards":
                game_stats.wilds++;
                s += "1s are wildcards for this game.\n";
                new_game.wildcards = true;
                break;

            case "--numdice":
                if ((i + 1) < cmd.length) {
                    let num_dice = parseInt(cmd[i + 1]);

                    if (!num_dice || num_dice < 1 || num_dice > 10) {
                        s += "Unable to parse number of dice correctly (must be number between 1 and 10)\n";
                    } else {
                        new_game.dice = num_dice;
                    }
                } else {
                    s += "Flag --numdice was included but no value provided\n";
                }
                break;
            }
        }
        let g = "" + game_id;
        game_id++;
        let gid = pad.substring(g.length) + g;
        new_game.gid = gid;
        new_game.members[message.user] = {
            dice: new_game.dice,
            smugs: 0
        };

        game_stats.total++;

        if (!game_stats.num_dice[new_game.dice]) {
            game_stats.num_dice[new_game.dice] = 1;
        } else {
            game_stats.num_dice[new_game.dice]++;
        }

        new_game.players.push(message.user);
        bot.replyInThread(message, s + `Made a new game for ${new_game.dice} dice, game_id is ${new_game.gid}. Players can join now! To participate reply in this thread.`, function(err, response) {
            if (err) {
                console.log("ERROR", err);
            } else {
                games[response.message.thread_ts] = new_game;
            }
        });

    } else {
        bot.replyInThread(message, `<@${message.user}> To start a game mention me with format "new game [--exact] [--wildcards] [--numdice <num_dice>]" (Flags are optional).`);
    }
});

controller.hears('join game', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to join a game! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (!games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game seems to have started already. Try making a new game!`);
    } else if (games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You seem to be already a member of this game!`);
    } else {
        games[message.thread_ts].members[message.user] = {
            dice: games[message.thread_ts].dice,
            smugs: 0
        };

        games[message.thread_ts].players.push(message.user);

        let mp = games[message.thread_ts].players.map(function(p) {
            return '<@' + p + '>';
        });

        bot.replyInThread(message, `Game ${games[message.thread_ts].gid} now has players ${mp.toString().replace(",", ", ")}.`);
    }
});

controller.hears('start game', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to start a game! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (!games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game seems to have started already!`);
    } else if (games[message.thread_ts].players.length < 2) {
        bot.replyInThread(message, `<@${message.user}> The game needs at least 2 players to start.`);
    } else {
        games[message.thread_ts].joinable = false;
        games[message.thread_ts].currentPlayer = 0;
        let m, roll;
        let numDice = 0;
        // for (var k in games[message.thread_ts].members) {
        for (let i = 0; i < games[message.thread_ts].players.length; i++) {
            // m = games[message.thread_ts].members[k].joinMessage;
            m = {
                user: games[message.thread_ts].players[i],
                channel: message.channel,
                thread_ts: message.thread_ts
            };

            roll = random.dice(6, games[message.thread_ts].dice);
            numDice += roll.length;
            games[message.thread_ts].members[m.user].roll = roll;
            bot.whisper(m, `You rolled ${roll.length} dice for game ${games[message.thread_ts].gid}: ${roll}`);
            // bot.startPrivateConversation(m, function(err, convo) {
            //     convo.say(`You rolled ${games[message.thread_ts].members[convo.source_message.user].roll.length} dice for game ${games[message.thread_ts].gid}: ${games[message.thread_ts].members[convo.source_message.user].roll}`);
            // });
        }

        games[message.thread_ts].totalDice = numDice;

        bot.replyInThread(message, `Game ${games[message.thread_ts].gid} has started, ${games[message.thread_ts].players.length} players have rolled ${games[message.thread_ts].dice} dice. It is <@${games[message.thread_ts].players[games[message.thread_ts].currentPlayer]}>'s turn to bet. Good luck!`);
    }
});

controller.hears('quit game', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to quit! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (!games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You are not a member of this game.`);
    } else {
        delete games[message.thread_ts].members[message.user];
        let s = `<@${message.user}> Has left the game!`;
        if (games[message.thread_ts].joinable) {
            let p = [];

            for (let i = 0; i < games[message.thread_ts].players.length; i++) {
                if (games[message.thread_ts].players[i] !== message.user) {
                    p.push(games[message.thread_ts].players[i]);
                }
            }
            games[message.thread_ts].players = p;
            bot.replyInThread(message, s);

        } else {
            games[message.thread_ts].totalDice -= games[message.thread_ts].members[message.user].roll.length;
            if (!players[message.user]) {
                players[message.user] = {
                    wins: 0,
                    losses: 0,
                    smugs: games[message.thread_ts].members[message.user].smugs
                };
            } else {
                players[message.user].smugs += games[message.thread_ts].members[message.user].smugs;
            }
            let winner = Object.keys(games[message.thread_ts].members)[0];
            checkWinner(games[message.thread_ts], winner, message.user, bot, message, s);
        }
    }
});

controller.hears('bet', 'direct_mention', function(bot, message) {
    let cmd = message.text.split(" ");

    if (cmd.length === 3) {
        let nD = parseInt(cmd[1]);
        let dV = parseInt(cmd[2]);

        if (!message.thread_ts) {
            bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to make a bet! Try replying to a thread, or make a new game!`);
        } else if (!games[message.thread_ts]) {
            bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
        } else if (games[message.thread_ts].joinable) {
            bot.replyInThread(message, `<@${message.user}> This game has not started yet.`);
        } else if (games[message.thread_ts].players[games[message.thread_ts].currentPlayer] !== message.user) {
            bot.replyInThread(message, `<@${message.user}> It is not your turn to bet!`);
        } else if (!nD || !dV) {
            bot.replyInThread(message, `<@${message.user}> num_die and die_value must be numbers greater than 0!`);
        } else if (dV < 1 || dV > 6) {
            bot.replyInThread(message, `<@${message.user}> die_value must be between 1 and 6!`);
        } else {
            if (!!games[message.thread_ts].lastBet && (nD < games[message.thread_ts].lastBet.amount || (nD === games[message.thread_ts].lastBet.amount && dV <= games[message.thread_ts].lastBet.value))) {
                bot.replyInThread(message, `<@${message.user}> You did not up the bet properly! num_dice must get larger or num_dice stays the same AND die_value gets larger!`);
                return;
            }

            games[message.thread_ts].lastBet = {
                amount: nD,
                value: dV,
                better: message.user
            };

            games[message.thread_ts].currentPlayer++;
            games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;

            while (!games[message.thread_ts].members[games[message.thread_ts].players[games[message.thread_ts].currentPlayer]]) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            games[message.thread_ts].history.push(`<@${message.user}> bet ${nD} ${dV}s`);
            bot.replyInThread(message, `<@${games[message.thread_ts].players[games[message.thread_ts].currentPlayer]}> It is now your turn to bet!`);

        }

    } else {
        bot.replyInThread(message, `<@${message.user}> To bet you must mention me with format "bet <num_dice> <die_value> in a game thread."`);
    }
});

controller.hears('prob amount', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to check the history! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game hasn't started yet.`);
    } else if (!games[message.thread_ts].lastBet) {
        bot.replyInThread(message, `<@${message.user}> There is no bet to calculate probablility for.`);
    } else {
        let p = blindProbability(games[message.thread_ts].totalDice, games[message.thread_ts].lastBet.amount, false, games[message.thread_ts].wildcards, games[message.thread_ts].lastBet.value);
        bot.replyInThread(message, `<@${message.user}> The probability of at least ${games[message.thread_ts].lastBet.amount} ${games[message.thread_ts].lastBet.value}s is ${p}%`);
    }
});


controller.hears('prob exactly', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to check the history! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game hasn't started yet.`);
    } else if (!games[message.thread_ts].lastBet) {
        bot.replyInThread(message, `<@${message.user}> There is no bet to calculate probablility for.`);
    } else {
        let p = blindProbability(games[message.thread_ts].totalDice, games[message.thread_ts].lastBet.amount, true, games[message.thread_ts].wildcards, games[message.thread_ts].lastBet.value);
        bot.replyInThread(message, `<@${message.user}> The probability of exactly ${games[message.thread_ts].lastBet.amount} ${games[message.thread_ts].lastBet.value}s is ${p}%`);
    }
});

controller.hears(['bs', 'BS', 'liar', 'LIAR'], 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to call BS! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game has not started yet.`);
    } else if (!games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You either are not playing, or have been eliminated already!`);
    } else if (!games[message.thread_ts].lastBet) {
        bot.replyInThread(message, `<@${message.user}> There is no bet to call BS on!`);
    } else if (games[message.thread_ts].lastBet.better === message.user) {
        bot.replyInThread(message, `<@${message.user}> You can't call BS on yourself!`);
    } else {
        let nD = 0;
        let rolls = "";
        for (var k in games[message.thread_ts].members) {
            rolls += `<@${k}> had ${games[message.thread_ts].members[k].roll}\n`;
            for (let i = 0; i < games[message.thread_ts].members[k].roll.length; i++) {
                if (games[message.thread_ts].members[k].roll[i] === games[message.thread_ts].lastBet.value || (games[message.thread_ts].members[k].roll[i] === 1 && games[message.thread_ts].wildcards)) {
                    nD++;
                }
            }
        }

        let winner;
        let loser;
        let dasright = "";
        if (nD >= games[message.thread_ts].lastBet.amount) {
            winner = games[message.thread_ts].lastBet.better;
            loser = message.user;
            if (games[message.thread_ts].lastBet.amount > (0.33 * games[message.thread_ts].totalDice)) {
                dasright = " BOOM! DAAAAAAAZZZZ RIIIIIGHT :smugroy:";
                games[message.thread_ts].members[winner].smugs++;
            }
        } else {
            winner = message.user;
            loser = games[message.thread_ts].lastBet.better;
        }

        let s = rolls + `There were ${nD} ${games[message.thread_ts].lastBet.value}s${games[message.thread_ts].wildcards ? " (including wildcard 1s)" : ""}.\n`;
        s += `<@${winner}> won the round and <@${loser}> lost a die.${dasright}\n`;
        games[message.thread_ts].members[loser].dice--;
        games[message.thread_ts].totalDice--;
        games[message.thread_ts].history = [];
        delete games[message.thread_ts].lastBet;
        if (games[message.thread_ts].members[loser].dice === 0) {
            s += `<@${loser}> has no more dice and was eliminated :notlikethis:\n`;

            if (!players[loser]) {
                players[loser] = {
                    wins: 0,
                    losses: 0,
                    smugs: games[message.thread_ts].members[loser].smugs
                };
            } else {
                players[loser].smugs += games[message.thread_ts].members[loser].smugs;
            }

            delete games[message.thread_ts].members[loser];
            checkWinner(games[message.thread_ts], winner, loser, bot, message, s);
        } else {
            while (games[message.thread_ts].players[games[message.thread_ts].currentPlayer] !== loser) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            rollAllDice(games[message.thread_ts], bot, message);
            s += `<@${loser}> It is your turn to bet! There are ${games[message.thread_ts].totalDice} dice left.`;
            bot.replyInThread(message, s);
        }
    }
});

controller.hears('exact', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to call exact! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game has not started yet.`);
    } else if (!games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You either are not playing, or have been eliminated already!`);
    } else if (!games[message.thread_ts].exact) {
        bot.replyInThread(message, `<@${message.user}> Exact is not enabled for this game`);
    } else if (!games[message.thread_ts].lastBet) {
        bot.replyInThread(message, `<@${message.user}> There is no bet to call exact on!`);
    } else if (games[message.thread_ts].lastBet.better === message.user) {
        bot.replyInThread(message, `<@${message.user}> You can't call exact on yourself!`);
    } else {
        let nD = 0;
        let rolls = "";
        for (var k in games[message.thread_ts].members) {
            rolls += `<@${k}> had ${games[message.thread_ts].members[k].roll}\n`;
            for (let i = 0; i < games[message.thread_ts].members[k].roll.length; i++) {
                if (games[message.thread_ts].members[k].roll[i] === games[message.thread_ts].lastBet.value || (games[message.thread_ts].members[k].roll[i] === 1 && games[message.thread_ts].wildcards)) {
                    nD++;
                }
            }
        }

        let correct = (nD === games[message.thread_ts].lastBet.amount);
        let better = games[message.thread_ts].lastBet.better;
        let guesser = message.user;
        let nextUser = better;
        let s = rolls + `There were ${nD} ${games[message.thread_ts].lastBet.value}s${games[message.thread_ts].wildcards ? " (including wildcard 1s)" : ""}.\n`;

        if (correct) {
            s += `<@${guesser}> guessed the exact amount and gained a die.\n`;
            games[message.thread_ts].members[guesser].dice++;
            games[message.thread_ts].totalDice++;
            nextUser = guesser;
        } else {
            nextUser = guesser;
            s += `<@${guesser}> did not guess the exact amount and lost a die.\n`;
            games[message.thread_ts].members[guesser].dice--;
            games[message.thread_ts].totalDice--;
        }
        games[message.thread_ts].history = [];
        delete games[message.thread_ts].lastBet;
        if (games[message.thread_ts].members[guesser].dice === 0) {
            s += `<@${guesser}> has no more dice and was eliminated :notlikethis:\n`;
            if (!players[guesser]) {
                players[guesser] = {
                    wins: 0,
                    losses: 0,
                    smugs: games[message.thread_ts].members[guesser].smugs
                };
            } else {
                players[guesser].smugs += games[message.thread_ts].members[guesser].smugs;
            }
            delete games[message.thread_ts].members[guesser];
            checkWinner(games[message.thread_ts], better, guesser, bot, message, s);
        } else {
            while (games[message.thread_ts].players[games[message.thread_ts].currentPlayer] !== nextUser) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            rollAllDice(games[message.thread_ts], bot, message);
            s += `<@${nextUser}> It is your turn to bet! There are ${games[message.thread_ts].totalDice} dice left.`;
            bot.replyInThread(message, s);
        }
    }
});

controller.hears('check dice', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to check your dice! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game hasn't started yet.`);
    } else if (!games[message.thread_ts].members[message.user]) {
        let s = `For game ${games[message.thread_ts].gid} this round players rolled ${games[message.thread_ts].totalDice} dice:`;
        let dicePlayed = {};
        for (let k in games[message.thread_ts].members) {
            s += `<@${k}> ${games[message.thread_ts].members[k].roll}\n`;
            for (let i = 0; i < games[message.thread_ts].members[k].roll.length; i++) {
                if (dicePlayed[games[message.thread_ts].members[k].roll[i]]) { 
                    dicePlayed[games[message.thread_ts].members[k].roll[i]]++;
                } else {
                    dicePlayed[games[message.thread_ts].members[k].roll[i]] = 1;
                }
            }
        }

        for (let i2 = 1; i2 < 7; i2++) {
            if (dicePlayed[i2]) {
                s += `There are ${dicePlayed[i2]} ${i2}s\n`;        
            }
        }
        bot.whisper(message, s);
    } else {
        let s = `For game ${games[message.thread_ts].gid} this round you rolled: ${games[message.thread_ts].members[message.user].roll}\n`;

        for (let k in games[message.thread_ts].members) {
            s += `<@${k}> has ${games[message.thread_ts].members[k].roll.length} dice\n`;
        }

        bot.whisper(message, s);
    }
});



controller.hears('history', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to check the history! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game hasn't started yet.`);
    } else {
        let s = `Past bets this round (${games[message.thread_ts].totalDice} dice remaining):\n`;

        for (let i = 0; i < games[message.thread_ts].history.length; i++) {
            s += games[message.thread_ts].history[i] + "\n";
        }

        bot.replyInThread(message, s);
    }
});

controller.hears('players', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to see who's playing! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if (games[message.thread_ts].joinable) {
        let mp = games[message.thread_ts].players.map(function(p) {
            return '<@' + p + '>';
        });

        bot.replyInThread(message, `Game ${games[message.thread_ts].gid} has players ${mp.toString().replace(",", ", ")}.`);
    } else {
        let pp = [];
        for (let i = 0; i < games[message.thread_ts].players.length; i++) {
            if (games[message.thread_ts].members[games[message.thread_ts].players[i]]) {
                pp.push(`<@${games[message.thread_ts].players[i]}>`);
            }
        }

        bot.replyInThread(message, `Game ${games[message.thread_ts].gid} has players ${pp.toString().replace(",", ", ")}.\nIt is <@${games[message.thread_ts].players[games[message.thread_ts].currentPlayer]}>'s turn.`);
    }
});

controller.hears('help', ['direct_mention', 'direct_message'], function(bot, message) {
    bot.replyInThread(message, getCommands());
});

controller.hears('rules', ['direct_mention', 'direct_message'], function(bot, message) {
    bot.replyInThread(message, getRules());
});

controller.hears('hello world', 'direct_message', function(bot, message) {
    console.log("MESSAGE", message);
    bot.reply(message, `<@${message.user}> Hello there. ${random.dice(6, 5)}`);
});

controller.hears('stats', 'direct_mention', function(bot, message) {
    let s = `
    These are the current stats:\n
    ~~~~~~~~\n
    Player Leaderboard:\n`;
    let pls = [];
    let pl;
    let wp;
    for (let key in players) {
        pl = {};
        pl.wins = players[key].wins;
        wp = 100;
        if (players[key].losses > 0) {
            wp = Math.floor(players[key].wins / (players[key].losses + players[key].wins) * 100);
        }
        pl.str = `    <@${key}> ${players[key].wins}-${players[key].losses} (${wp}%) with ${players[key].smugs} :smugroy:\n`;
        pls.push(pl);
    }

    pls.sort(function(a, b) {
        return b.wins - a.wins;
    });

    for (let i = 0; i < pls.length; i++) {
        s += pls[i].str;
    }
    s += `
    ~~~~~~~~\n
    Game Stats:\n
    Total Games - ${game_stats.total}\n
    Completed Games - ${game_stats.complete}\n
    Wildcard Games - ${game_stats.wilds}\n
    Exact Games - ${game_stats.exact}\n
    ~~~~~~~~\n
    Num Dice Breakdown:\n`;

    for (let i2 = 1; i2 < 11; i2++) {
        if (!game_stats.num_dice["" + i2]) {
            s += `    ${i2} Dice - 0 Games Played\n`;
        } else {
            s += `    ${i2} Dice - ${game_stats.num_dice["" + i2]} Games Played\n`;
        }
    }

    bot.replyInThread(message, s);
});


/**
 * AN example of what could be:
 * Any un-handled direct mention gets a reaction and a pat response!
 */
controller.on('direct_message,mention,direct_mention', function(bot, message) {
    // console.log(message)
    bot.replyInThread(message, `<@${message.user}> Did not recognize that command. Try "help"`);
});