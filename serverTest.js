//================================================================================================================================|
// PACKAGE SETUP, REQUIRES, ETC
//================================================================================================================================|
var app = require('express')(); // used for simplified http methods for getting/posting/etc
var fs = require('fs'); // file system

// body parser gives us access to req.body stuff
var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true })) // To parse URL encoded data
app.use(bodyParser.json()) // for parsing application/json

// Certificate info for creating self-signed certificate
// openssl genrsa -out server.key 1024
// openssl req -new -key server.key -out server.csr
// openssl x509 -req -days 10950 -in server.csr -signkey server.key -out server.crt
/* var options = {
	key: fs.readFileSync('encryption/server.key'),
	cert: fs.readFileSync( 'encryption/server.crt' ),
	requestCert: false,
    rejectUnauthorized: false,
}; */

// Create server using the encryption options created above
var server = require('http').Server(app)

// Saving this for later in case I need to serve files to the user, like when changing icons and such?
//var path = "C:/NodeJS/test-project/"; // express sendFile needs to be provided an absolute path, unless using root in options
// res.sendFile(path + 'index.html');

// socket.io
var io = require('socket.io').listen(server);
io.attach(4567);

// json web tokens, need to use Buffer.from(<secretGoesHere>, 'base64') to verify the secret that twitch generates
var jwt = require('jsonwebtoken');

var count = 0;

//================================================================================================================================|
// ORGANIZING ROUTES
//================================================================================================================================|
//var routes = require('./routes.js'); // require routes that will organize what we do with certain entites related to HTTP methods
//app.use('/', routes); // use things route on "/things" URL

//================================================================================================================================|
// SOCKET.IO
//================================================================================================================================|
var browserClients = [];
var clientSecret = "JgFd0a0l+rK2pw4/JYx8fkDEC5QvJNgnQtiSKttoXxg="; // from VaultsAndViewers
//var clientSecret = "JNsCWUJa90qzwa7naE8sLVjNmxJHijle8kFXLEviaaE="; // from CastawayArcade
var socketToUnityGame;

io.on('connection', function(socket){
	
	//console.log("Some kind of user connected to socket...");
	//console.log("Connection type is: " + socket.request.query['connectionType']);
	//console.dir(socket.request._query.connectionType);
	
	var connectionType = socket.request._query.connectionType;
	
	if (connectionType === "game"){
		console.log("\x1b[36;1m%s\x1b[0m", "UNITY GAME socket connected."); // weird stuff at the front of this log is for cyan color https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
		socketToUnityGame = socket;
		
		SetupGameConnectionEvents(socket);
		
		socket.on('disconnect', function(){
			console.log("\x1b[31;1m%s\x1b[0m", "UNITY GAME socket disconnected.");
			socketToUnityGame = null;
		});
	}
	else if (connectionType === "browser"){
		console.log("\x1b[35;1m%s\x1b[0m", "TWITCH EXTENSION socket connected.");
		// Make sure all browser connections get removed from our array of connections on disconnect
		socket.on("disconnect", function(){
			console.log("\x1b[31;1m%s\x1b[0m", "TWITCH EXTENSION socket disconnected.");
			browserClients.splice(browserClients.indexOf(socket), 1); // remove this connection from our list
		});
		
		socket.on('browserConnection', function(callback){
			//console.dir(authInfo);
			console.log("Browser Connected!");
			count++;
			callback(count);
			
			/* jwt.verify(authInfo.token, Buffer.from(clientSecret, 'base64'), function(err, decoded){
				console.log("\x1b[35;1m%s\x1b[0m", "AuthInfo before decode is: ");
				console.dir(authInfo);
				console.log("\x1b[35;1m%s\x1b[0m", "Decoded JWT is: ");
				console.dir(decoded);
				if (err){
					console.log("There was an error with the JWT, disconnecting...");
					callback({connected:'no'});
					socket.disconnect();
				}
				else{
					console.log("\x1b[35;1m%s\x1b[0m", "JWT verified! Setting up socket for opaque_user_id: " + decoded.opaque_user_id);
					socket.opaqueUserId = decoded.opaque_user_id; // need to store opaque ID as per viewer data in case we can't get twitch ID
					socket.twitchUserId = decoded.user_id; // associate twitch userID with this socket
					browserClients.push(socket); // add this verified socket to our list
					SetupBrowserConnectionEvents(socket, decoded);
					callback({connected:'yes', playerType:'normal'});
					// Need to send this information to the game, set up user by doing twitch API calls to get display name/etc
				}
			}); */
		});
	}
	else{
		// This logic shouldn't even get here because if the JWT is not valid, the browser never sends a connection
		// I guess it'd have to be from somwhere else other than viewer.html that is trying to connect for some reason
		console.log("Couldn't determine what this connection is, shutting it down.");
		socket.on("disconnect", function(){
			console.log("Diconnecting foreign socket now!");
		});
		socket.disconnect();
	}
})

//=============================================================|
// GAME EVENTS (events sent from the Unity game)
//=============================================================|
function SetupGameConnectionEvents(socket)
{
	// Game sends message to display the character sheet (after joining or creating a character)
	socketToUnityGame.on('displayCharacterSheet', function(data){
		viewerSocket = GetSocketByTwitchUserId(data.opaqueUserId)
		if (viewerSocket)
		{
			viewerSocket.emit("displayCharacterSheet", data);
		}
		else
		{
			console.log("Could not find socket for this user!");
			console.log(data);
		}
	});	
}

//=============================================================|
// BROWSER EVENTS (events sent from the twitch extension)
//=============================================================|
function SetupBrowserConnectionEvents(socket, decodedJWT)
{
	// Here is where events sent from an viewer's extension will be routed to the unity game
	socket.on('viewerJoinedEvent', function(){ // send twitch user ID of this command issuer
		var joiningViewerPacket = {opaqueUserId: socket.opaqueUserId, twitchUserId: socket.twitchUserId};
		//console.dir(joiningViewerPacket);
		socketToUnityGame.emit("viewerJoinedEvent", joiningViewerPacket);
	});
	
	socket.on('characterCreated', function(createdCharacterInfo){ // send twitch user ID of this command issuer as well as character creation info
		var createdCharacterPacket = {opaqueUserId: socket.opaqueUserId,
									   twitchUserId: socket.twitchUserId,
									   strengthScore: createdCharacterInfo.strengthScore,
									   dexterityScore: createdCharacterInfo.dexterityScore,
									   constitutionScore: createdCharacterInfo.constitutionScore,
									   intelligenceScore: createdCharacterInfo.intelligenceScore,
									   wisdomScore: createdCharacterInfo.wisdomScore,
									   charismaScore: createdCharacterInfo.charismaScore,
									   raceNum: createdCharacterInfo.raceNum,
									   classNum: createdCharacterInfo.classNum,};
		console.log("\x1b[35;1m%s\x1b[0m", "Sending this character info to the game to be created:");
		console.dir(createdCharacterPacket);
		socketToUnityGame.emit("characterCreatedEvent", createdCharacterPacket);
	});
}

//================================================================================================================================|
// MIDDLEWARE FUNCTIONS
//================================================================================================================================|
// CORS stuff, not sure if it was working correctly or not though, might be? cause I'm able to make post requests now... hmm...
app.use(function (req, res, next) {
	
    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8012');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

//================================================================================================================================|
// HTTP METHODSs
//================================================================================================================================|
/* app.post('/gameEvents', function(req, res) {
	var eventMessage = req.body.eventMessage;
	if (eventMessage == 'joinGame')
	{
		console.log("Player is joining the game!");
	}
	else
	{
		console.log("Received unknown gameEvent!");
	}
	
	res.send({countNum: count});
});

var count = 0;
app.post('/count', function(req, res) {
	var countFuncType = req.body.type;
	if (countFuncType == 'up')
	{
		if (socketToUnityGame)
		{
			console.log("Hit Up!");
			socketToUnityGame.emit("countUp");
		}
		count = count + 1;
	}
	else if (countFuncType == 'down')
	{
		if (socketToUnityGame)
			socketToUnityGame.emit("countDown");
		count = count - 1;
	}
	else if (countFuncType == 'left')
	{
		if (socketToUnityGame)
			socketToUnityGame.emit("countLeft");
		count = count - 1;
	}
	else if (countFuncType == 'right')
	{
		if (socketToUnityGame)
			socketToUnityGame.emit("countRight");
		count = count + 1;
	}
	else
	{
		console.log('count was not changed, something went wrong');
	}
	
	res.send({countNum: count});
}); */

// This should be the last http get route because they are executed in order, so if none match it can show a bad URL message
app.get('*', function(req, res){
   res.send('Sorry, this is an invalid URL.');
});

//================================================================================================================================|
// SERVER
//================================================================================================================================|
var port = process.env.PORT || 3000;
var host = "127.0.0.1";
server.listen(port, function() {
   console.log('listening on *:' + port);
});





//================================================================================================================================|
// HELPER FUNCTIONS
//================================================================================================================================|
function GetSocketByTwitchUserId(thisUserId)
{
	if (browserClients.length > 0) // if we have clients connected and in our list
	{
		var retrievedSocket = browserClients.filter(function( obj ) {
			return obj.opaqueUserId == thisUserId;
		})[0]; // normally this returns an array of sockets that match the criteria, so I have to get the first element since I'm only expecting one
		
		//console.log("Returning socket with twitch ID: " + thisUserId);
		return retrievedSocket;
	}
	else
	{
		console.log("Could not retrieve twitch user id: " + thisUserId + " because there are no clients connected!");
		return undefined;
	}
}







