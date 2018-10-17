/**
 * A Bot for Slack!
 */


/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
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
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */

if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);
} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
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

function rollDice(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollAllDice(game, bot, message) {
    for (let k in game.members) {
        let roll = [];
        let m = {
            user: k,
            channel: message.channel,
            thread_ts: message.thread_ts
        };

        for (let i = 0; i < game.members[k].dice; i++) {
            roll.push(rollDice(1,6));
        }
        game.members[k].roll = roll;
        bot.startPrivateConversation(m, function(err, convo) {
            convo.say(`You rolled ${games[message.thread_ts].members[convo.source_message.user].roll.length} dice for game ${games[message.thread_ts].gid}: ${games[message.thread_ts].members[convo.source_message.user].roll}`);
        });
        // bot.whisper(m, `You rolled ${roll.length} dice for game ${game.gid}: ${roll}`);
    }
}

function checkWinner(game, winner, loser, bot, message, s) {
    if (Object.keys(game.members).length == 1) {
        for (let i = 0; i < game.players.length; i++) {
            if (!players[game.players[i]]) {
                players[game.players[i]] = {
                    wins: 0,
                    losses: 0
                };
            }

            if (game.players[i] == winner) {
                players[game.players[i]].wins++;
            } else {
                players[game.players[i]].losses++;
            }
        }

        bot.replyInThread(message, s + `<@${winner}> has won the game! Their win total is now ${players[winner].wins}, congratulations! This game has now concluded, please start a new game to play again.`);
    } else {
        let found = false;
        rollAllDice(game, bot, message);
        while(!game.players[game.currentPlayer] || !found) {
            if (game.players[game.currentPlayer] == loser) {
                found = true;
            }

            game.currentPlayer++;
            game.currentPlayer = game.currentPlayer < game.players.length ? game.currentPlayer : 0;
        }
        s += `<@${game.players[game.currentPlayer]}> It is your turn to bet! There are ${game.totalDice} dice left.`
        bot.replyInThread(message, s);
    }
}
function getCommands() {
    let s = `
    To run a command you must mention the but (@liars_dice_bot) with the appropriate command string.\n
    (*) Commands do not have strict formatting\n\n
    Top Level Commands (Made directly in channel):\n
    "new game [--exact] [--wildcards] [--numdice <num_dice>]" - Creates a new game with specified options (Flags are all optional)\n
    "help" (*) - Display this command list (Can be done in thread as well)\n\n
    Game Commands (Must be made in game thread):
    "join game" (*) - Join the game running in the message thread\n
    "start game" (*) - Start the game in the thread (no more players can join)\n
    "bet <num_dice> <dice_value>" - Make a bet that there are at least num_dice of dice_value among all players\n
    "bs || liar" (*) - Challenge the last made bet (any player may call this)\n
    "history" (*) - Show a histroy of the bets made in the current round\n
    `
    return s;
}

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, getCommands());
});


controller.hears('kill game', 'direct_mention', function(bot, message) {
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to kill a game.`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed.`);
    } else {
        delete games[message.thread_ts];
        bot.replyInThread(message, `<@${message.user}> Killed the game.`)
    }
});

controller.hears('new game', 'direct_mention', function(bot, message) {


    if (message.match.index == 0) {
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

        let s = ""
        for (let i = 2; i < cmd.length; i++) {
            switch (cmd[i]) {
                case "--exact":
                    new_game.exact = true;
                    s += "Exact command is enabled for this game.\n"
                    break;

                case "--wildcards":
                    s += "1s are wildcards for this game.\n"
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
            dice: new_game.dice
        };

        new_game.players.push(message.user);
        bot.replyInThread(message, s + `Made a new new game for ${new_game.dice} dice, game_id is ${new_game.gid}. Players can join now! To participate reply in this thread.`, function (err, response) {
            if (err) {
                console.log("ERROR",err);
            } else {
                games[response.message.thread_ts] = new_game;
            }
        });

    } else {
            bot.replyInThread(message, `<@${message.user}> To start a game mention me with format "new game [--exact] [--wildcards] [--numdice <num_dice>]" (Flags are optional).`);
    }
});

controller.hears('join game', 'direct_mention', function(bot, message) {
    let cmd = message.text.split(" ");
    if (!message.thread_ts) {
        bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to join a game! Try replying to a thread, or make a new game!`);
    } else if (!games[message.thread_ts]) {
        bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
    } else if(!games[message.thread_ts].joinable) {
        bot.replyInThread(message, `<@${message.user}> This game seems to have started already. Try making a new game!`);
    } else if (!!games[message.thread_ts].members[message.user]) {
        bot.replyInThread(message, `<@${message.user}> You seem to be already a member of this game!`);
    } else {
        games[message.thread_ts].members[message.user] = {
            dice: games[message.thread_ts].dice
        };

        games[message.thread_ts].players.push(message.user);

        let mp = games[message.thread_ts].players.map(function(p) {
            return '<@' + p + '>';
        });

        bot.replyInThread(message, `Game ${games[message.thread_ts].gid} now has players ${mp.toString().replace(",", ", ")}.`);
    }
});

controller.hears('start game', 'direct_mention', function(bot, message) {
    let cmd = message.text.split(" ");
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
        for (let i = 0; i < games[message.thread_ts].players.length; i ++) {
            // m = games[message.thread_ts].members[k].joinMessage;
            m = {
                user: games[message.thread_ts].players[i],
                channel: message.channel,
                thread_ts: message.thread_ts
            };

            roll = [];
            for (let i2 = 0; i2 < games[message.thread_ts].dice; i2++) {
                roll.push(rollDice(1, 6));
                numDice ++;
            }

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

controller.hears('bet', 'direct_mention', function(bot, message) {
    let cmd = message.text.split(" ");

    if (cmd.length == 3) {
        let nD = parseInt(cmd[1]);
        let dV = parseInt(cmd[2]);

        if (!message.thread_ts) {
            bot.replyInThread(message, `<@${message.user}> You need to mention me in game thread to make a bet! Try replying to a thread, or make a new game!`);
        } else if (!games[message.thread_ts]) {
            bot.replyInThread(message, `<@${message.user}> There doesn't seem to be a game going on in this thread, or it is completed. Try making a new game!`);
        } else if (games[message.thread_ts].joinable) {
            bot.replyInThread(message, `<@${message.user}> This game has not started yet.`);
        } else if (games[message.thread_ts].players[games[message.thread_ts].currentPlayer] != message.user) {
            bot.replyInThread(message, `<@${message.user}> It is not your turn to bet!`);
        } else if (!nD || !dV) {
            bot.replyInThread(message, `<@${message.user}> num_die and die_value must be numbers greater than 0!`);
        } else if (dV < 1 || dV > 6) {
            bot.replyInThread(message, `<@${message.user}> die_value must be between 1 and 6!`);
        } else {
            if (!!games[message.thread_ts].lastBet && (nD < games[message.thread_ts].lastBet.amount || (nD == games[message.thread_ts].lastBet.amount && dV <= games[message.thread_ts].lastBet.value))) {
                bot.replyInThread(message, `<@${message.user}> You did not up the bet properly! num_dice must get larger or num_dice stays the same AND die_value gets larger!`);
                return;
            }

            games[message.thread_ts].lastBet = {
                amount: nD,
                value: dV,
                better: message.user
            }

            games[message.thread_ts].currentPlayer++;
            games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;

            while(!games[message.thread_ts].members[games[message.thread_ts].players[games[message.thread_ts].currentPlayer]]) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            games[message.thread_ts].history.push(`<@${message.user}> bet ${nD} ${dV}s`);
            bot.replyInThread(message, `<@${games[message.thread_ts].players[games[message.thread_ts].currentPlayer]}> It is now your turn to bet!`);

        }

    } else {
        bot.replyInThread(message, `<@${message.user}> To bet you must mention me with format "bet <num_dice> <die_value> in a game thread."`)
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
    } else if (games[message.thread_ts].lastBet.better == message.user) {
        bot.replyInThread(message, `<@${message.user}> You can't call BS on yourself!`);
    } else {
        let nD = 0;
        let rolls = "";
        for (var k in games[message.thread_ts].members) {
            rolls += `<@${k}> had ${games[message.thread_ts].members[k].roll}\n`;
            for (let i = 0; i < games[message.thread_ts].members[k].roll.length; i++ ) {
                if (games[message.thread_ts].members[k].roll[i] == games[message.thread_ts].lastBet.value || (games[message.thread_ts].members[k].roll[i] == 1 && games[message.thread_ts].wildcards)) {
                    nD++;
                }
            }
        }

        let winner;
        let loser
        if (nD >= games[message.thread_ts].lastBet.amount) {
            winner = games[message.thread_ts].lastBet.better;
            loser = message.user;
        } else {
            winner = message.user;
            loser = games[message.thread_ts].lastBet.better;
        }

        let s = rolls + `There were ${nD} ${games[message.thread_ts].lastBet.value}s${games[message.thread_ts].wildcards ? " (including wildcard 1s)" : ""}.\n` 
        s += `<@${winner}> won the round and <@${loser}> lost a die.\n`
        games[message.thread_ts].members[loser].dice--;
        games[message.thread_ts].totalDice--;
        games[message.thread_ts].history = [];
        delete games[message.thread_ts].lastBet;
        if (games[message.thread_ts].members[loser].dice == 0) {
            s += `<@${loser}> has no more dice and was eliminated\n`;
            delete games[message.thread_ts].members[loser];
            checkWinner(games[message.thread_ts], winner, loser, bot, message, s);
        } else {
            while(games[message.thread_ts].players[games[message.thread_ts].currentPlayer] != loser) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            rollAllDice(games[message.thread_ts], bot, message)
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
        bot.replyInThread(message, `<@${message.user}> Exact is not enabled for this game`)
    } else if (!games[message.thread_ts].lastBet) {
        bot.replyInThread(message, `<@${message.user}> There is no bet to call exact on!`);
    } else if (games[message.thread_ts].lastBet.better == message.user) {
        bot.replyInThread(message, `<@${message.user}> You can't call exact on yourself!`);
    } else {
        let nD = 0;
        let rolls = "";
        for (var k in games[message.thread_ts].members) {
            rolls += `<@${k}> had ${games[message.thread_ts].members[k].roll}\n`;
            for (let i = 0; i < games[message.thread_ts].members[k].roll.length; i++ ) {
                if (games[message.thread_ts].members[k].roll[i] == games[message.thread_ts].lastBet.value || (games[message.thread_ts].members[k].roll[i] == 1 && games[message.thread_ts].wildcards)) {
                    nD++;
                }
            }
        }

        let correct = (nD == games[message.thread_ts].lastBet.amount);
        let better = games[message.thread_ts].lastBet.better;
        let guesser = message.user;
        let nextUser = better;
        let s = rolls + `There were ${nD} ${games[message.thread_ts].lastBet.value}s${games[message.thread_ts].wildcards ? " (including wildcard 1s)" : ""}.\n`;

        if (correct) {
            s += `<@${guesser}> guessed the exact amount and gained a die.\n`
            games[message.thread_ts].members[guesser].dice--;
            games[message.thread_ts].totalDice++;
        } else {
            nextUser = guesser
            s += `<@${guesser}> did not guess the exact amount and lost a die.\n`            
            games[message.thread_ts].members[guesser].dice--;
            games[message.thread_ts].totalDice--;
        }
        games[message.thread_ts].history = [];
        delete games[message.thread_ts].lastBet;
        if (games[message.thread_ts].members[guesser].dice == 0) {
            s += `<@${guesser}> has no more dice and was eliminated\n`;
            delete games[message.thread_ts].members[guesser];
            checkWinner(games[message.thread_ts], better, guesser, bot, message, s);
        } else {
            while(games[message.thread_ts].players[games[message.thread_ts].currentPlayer] != nextUser) {
                games[message.thread_ts].currentPlayer++;
                games[message.thread_ts].currentPlayer = games[message.thread_ts].currentPlayer < games[message.thread_ts].players.length ? games[message.thread_ts].currentPlayer : 0;
            }
            rollAllDice(games[message.thread_ts], bot, message)
            s += `<@${nextUser}> It is your turn to bet! There are ${games[message.thread_ts].totalDice} dice left.`;
            bot.replyInThread(message, s);
        }
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

controller.hears('help',['direct_mention', 'direct_message'], function(bot, message) {
    bot.replyInThread(message, getCommands());
});

controller.hears('hello world', 'direct_message', function(bot, message) {
    console.log("MESSAGE", message);
    bot.reply(message, "Hello there.")
})


/**
 * AN example of what could be:
 * Any un-handled direct mention gets a reaction and a pat response!
 */
controller.on('direct_message,mention,direct_mention', function (bot, message) {
    // console.log(message)
    bot.replyInThread(message, `<@${message.user}> Did not recognize that command. Try "help"`);
});
