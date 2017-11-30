/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk

const redis = require('redis'); //To store conversation context

var app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Using some globals for now
let conversation;
let redisClient;
let context;
let Wresponse;

// Create the service wrapper
var conversation_Web = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  //'username': process.env.CONVERSATION_USERNAME,
  //'password': process.env.CONVERSATION_PASSWORD,
  'version_date': '2017-05-26'
});

// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  // Send the input to the conversation service
  conversation_Web.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }
    return res.json(updateMessage(payload, data));
  });
});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

// Alexa handle part

// routes will go here

function errorResponse(reason) {
  return {
    version: '1.0',
    response: {
      shouldEndSession: true,
      outputSpeech: {
        type: 'PlainText',
        text: reason || 'An unexpected error occurred. Please try again later.'
      }
    }
  };
}

function initClients() {
  return new Promise(function(resolve, reject) {
  // Connect a client to Watson Conversation
  conversation = new ConversationV1({
  //'username': process.env.CONVERSATION_USERNAME,
  //'password': process.env.CONVERSATION_PASSWORD,
      version_date: '2016-09-20'
  });
  console.log('Connected to Watson Conversation');

    // Connect a client to Redis
  redisClient = redis.createClient('REDIS_PORT_NEED_TO_BE_REPLACED', 'REDIS_URL_NEED_TO_BE_REPLACED');
  redisClient.auth('NEED_TO_BE_REPLACED', function (err) {
      if (err) throw err;
  });
  redisClient.on('connect', function() {
      console.log('Connected to Redis');
  });
  resolve("Done");
});
}

function conversationMessage(request, workspaceId) {
  return new Promise(function(resolve, reject) {
    const input = request.intent ? request.intent.slots.EveryThingSlot.value : 'start skill';
      var test = {
          input: { text: input },
          workspace_id: workspaceId,
          context: context
        };
    console.log("Input" + JSON.stringify(test,null,2));
    conversation.message(
      {
        input: { text: input },
        workspace_id: workspaceId,
        context: context
      },
      function(err, watsonResponse) {
        if (err) {
          console.error(err);
          reject('Error talking to Watson.');
        } else {
          console.log(watsonResponse);
          context = watsonResponse.context; // Update global context
          
          resolve(watsonResponse);
        }
      }
    );
  });
}

function getSessionContext(sessionId) {
  console.log('sessionId: ' + sessionId);

  return new Promise(function(resolve, reject) {
    redisClient.get(sessionId, function(err, value) {
      if (err) {
        console.error(err);
        reject('Error getting context from Redis.');
      }
      // set global context
      context = value ? JSON.parse(value) : {};
      console.log('Context Recupéré:');
      console.log(context);
      resolve();
    });
  });
}

function saveSessionContext(sessionId) {
  console.log('Begin saveSessionContext');
  console.log(sessionId);

  // Save the context in Redis. Can do this after resolve(response).
  if (context) {
    const newContextString = JSON.stringify(context);
    // Saved context will expire in 600 secs.
    redisClient.set(sessionId, newContextString, 'EX', 600);
    console.log('Saved context in Redis');
    console.log(sessionId);
    console.log(newContextString);
  }
}

function sendResponse(response, resolve) {

  // Combine the output messages into one message.
  const output = response.output.text.join(' ');
  var resp = {
      version: '1.0',
      response: {
        shouldEndSession: false,
        outputSpeech: {
          type: 'PlainText',
          text: output
        }
      }
    };

  Wresponse =  resp;
  // Resolve the main promise now that we have our response
  resolve(resp);
}

app.post('/api/alexa', function(args, res) {
  return new Promise(function(resolve, reject) {
    const request = args.body.request;
    const sessionId = args.body.session.sessionId;
    initClients()
    .then(() => getSessionContext(sessionId))
    .then(() => conversationMessage(request, '<workspace-id>'))
    .then(actionResponse => sendResponse(actionResponse, resolve))
    .then(data => {
      res.json(Wresponse);
  })
  .then(() => saveSessionContext(sessionId))    
  .catch(function (err) {
      console.error('Erreur !');
      console.dir(err);
  });
  });
});

module.exports = app;
