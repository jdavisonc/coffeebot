/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/
This is a sample Slack bot built with Botkit.
This bot demonstrates many of the core features of Botkit:
* Connect to Slack using the real time API
* Receive messages based on "spoken" patterns
* Reply to messages
* Use the conversation system to ask questions
* Use the built in storage system to store and retrieve information
  for a user.
# RUN THE BOT:
  Get a Bot token from Slack:
    -> http://my.slack.com/services/new/bot
  Run your bot from the command line:
    token=<MY TOKEN> node slack_bot.js
# USE THE BOT:
  Find your bot inside Slack to send it a direct message.
  Say: "Hello"
  The bot will reply "Hello!"
  Say: "who are you?"
  The bot will tell you its name, where it is running, and for how long.
  Say: "Call me <nickname>"
  Tell the bot your nickname. Now you are friends.
  Say: "who am I?"
  The bot will tell you your nickname, if it knows one for you.
  Say: "shutdown"
  The bot will ask if you are sure, and then shut itself down.
  Make sure to invite your bot into other channels using /invite @<my bot>!
# EXTEND THE BOT:
  Botkit has many features for building cool and useful bots!
  Read all about it here:
    -> http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/


if (!process.env.TOKEN || !process.env.PARTICLE_TOKEN || !process.env.PARTICLE_DEVICE_ID || !process.env.SLACK_CHANNEL) {
    console.log('Error: Specify tokens in environment');
    process.exit(1);
}

var Botkit = require('botkit/lib/Botkit.js');
var os = require('os');
var requestify = require('requestify');
var eventsource = require('eventsource');
var Q = require('q');

var controller = Botkit.slackbot({
    debug: true
});

var slackChannel = null; //#coffee
var messages = {
    MESSAGE_TEXT_BREWING: 'I am preparing some coffee, stay tuned, I will let you know when is ready.',
    MESSAGE_TEXT_RUNNING_LOW: 'We have no coffee, sorry, but you can go to the kitchen and prepare more!',
    MESSAGE_TEXT_RUNNING_NORMAL: 'I still have coffee, but not for long... hurry!',
    MESSAGE_TEXT_RUNNING_FULL: 'I’m full of coffee, run and take you dosis!'
};
var particle = {
    TEMP_URL: 'https://api.particle.io/v1/devices/' + process.env.PARTICLE_DEVICE_ID + '/temp?access_token=' + process.env.PARTICLE_TOKEN,
    STATUS_URL: 'https://api.particle.io/v1/devices/' + process.env.PARTICLE_DEVICE_ID + '/status?access_token=' + process.env.PARTICLE_TOKEN,
    LEVEL_URL: 'https://api.particle.io/v1/devices/' + process.env.PARTICLE_DEVICE_ID + '/level?access_token=' + process.env.PARTICLE_TOKEN,
    EVENTS_URL: 'https://api.particle.io/v1/devices/' + process.env.PARTICLE_DEVICE_ID + '/events?access_token=' + process.env.PARTICLE_TOKEN
}


var bot = controller.spawn({
    token: process.env.TOKEN
}).startRTM(function (err, bot) {
    if (err) {
        throw new Error(err);
    }

    // @ https://api.slack.com/methods/channels.list
    bot.api.channels.list({}, function (err, response) {
        if (response.hasOwnProperty('channels') && response.ok) {
            var total = response.channels.length;
            for (var i = 0; i < total; i++) {
                var channel = response.channels[i];
                if (channel.name === process.env.SLACK_CHANNEL) {
                    slackChannel = channel;
                }
            }
        }
        if (slackChannel == null) {
            throw new Error('Channel '+ process.env.SLACK_CHANNEL + ' not found');
        }
    });
});

controller.setupWebserver(process.env.PORT,function(err,webserver) {
  controller.createWebhookEndpoints(controller.webserver);
});

controller.hears(['uptime', 'identify yourself', 'who are you', 'what is your name'],
    'direct_message,direct_mention,mention', function(bot, message) {

        var hostname = os.hostname();
        var uptime = formatUptime(process.uptime());

        bot.reply(message,
            ':robot_face: I am a bot named <@' + bot.identity.name +
             '>. I have been running for ' + uptime + ' on ' + hostname + '.');
    });

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}


/**
 * COFFEE MAKER ACTIONS
 */

// Listen for status keyword
controller.hears(['status'], 'direct_message,direct_mention,mention', function(bot, message) {
    var temperature = 0, status = 'error', level = 10;

    // Making it concurrent
    Q.all([
        requestify.get(particle.TEMP_URL),
        requestify.get(particle.STATUS_URL),
        requestify.get(particle.LEVEL_URL)
    ]).then(function(data){
        var temperature = data[0].getBody().result;
        var status = data[1].getBody().result;
        var level = data[2].getBody().result;

        if (level <= 10) {
            text = messages.MESSAGE_TEXT_RUNNING_LOW;
        } else if (level > 10 && level < 90) {
            text = messages.MESSAGE_TEXT_RUNNING_NORMAL;
        } else {
            text = messages.MESSAGE_TEXT_RUNNING_FULL;
        }
        bot.reply(message, text + ' :coffee: ' + status + ' :thermometer: ' + temperature + 'ºC :level_slider: ' + level + '%');
    });
});

// Listen for Particle events
controller.on('rtm_open', function(bot) {
    console.log("Listening on " + particle.EVENTS_URL + " ...");
    var es = new eventsource(particle.EVENTS_URL);
    es.addEventListener('STATUS', function(e){ 
        var event = JSON.parse(e.data);
        console.log("Event received: " + event);
        if (event.data === "BREWING") {
            console.log('Send status change to channel ' + event.data);
            bot.say({
                text: messages.MESSAGE_TEXT_BREWING,
                channel: slackChannel.id
            });
        }
    }, false);
});

