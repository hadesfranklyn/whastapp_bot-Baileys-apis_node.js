const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();


app.use(
    fileUpload({
        createParentPath: true,
    })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use(express.static(path.join(__dirname, "public")));

app.get("/scan", (req, res) => {
    res.sendFile("./public/index.html", {
        root: __dirname,
    });
});

app.get("/", (req, res) => {
    res.send("server working");
});

let sock;
let qrDinamic;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(
        // informações de autenticação da sessão
        "dist/session_auth_info"
    );

    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: log({ level: "silent" }),
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        qrDinamic = qr;
        if (connection === "close") {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(
                    `Arquivo de Sessão Ruim, Por favor, exclua ${session} e faça a varredura novamente`
                );
                sock.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Conexão fechada, reconectando....");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Conexão perdida do servidor, reconectando...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(
                    "Conexão substituída, outra nova sessão foi aberta, faça o logout da sessão atual primeiro"
                );
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(
                    `Dispositivo desconectado, exclua-o ${session} e faça a varredura novamente.`
                );
                sock.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Reinício necessário, reiniciando...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Tempo de conexão expirado, conectando...");
                connectToWhatsApp();
            } else {
                sock.end(
                    `Motivo de desconexão desconhecido: ${motivo}|${lastDisconnect.error}`
                );
            }
        } else if (connection === "open") {
            console.log("conexão aberta");
            return;
        }
    });

    // sock.ev.on("messages.upsert", async ({ messages, type }) => {
    //     try {
    //         if (type === "notify") {
    //             if (!messages[0]?.key.fromMe) {
    //                 const captureMessage = messages[0]?.message?.conversation;
    //                 const numberWa = messages[0]?.key?.remoteJid;

    //                 const compareMessage = captureMessage.toLocaleLowerCase();

    //                 if (compareMessage === "ping") {
    //                     await sock.sendMessage(
    //                         numberWa,
    //                         {
    //                             text: "Pong",
    //                         },
    //                         {
    //                             quoted: messages[0],
    //                         }
    //                     );
    //                 } else {
    //                     await sock.sendMessage(
    //                         numberWa,
    //                         {
    //                             text: "Eu sou um robô",
    //                         },
    //                         {
    //                             quoted: messages[0],
    //                         }
    //                     );
    //                 }
    //             }
    //         }
    //     } catch (error) {
    //         console.log("error ", error);
    //     }
    // });

    sock.ev.on("creds.update", saveCreds);
}

const isConnected = () => {
    return sock?.user ? true : false;
};

app.get("/send-message", async (req, res) => {
    const tempMessage = req.query.message;
    const number = req.query.number;

    let numberWA;
    try {
        if (!number) {
            res.status(500).json({
                status: false,
                response: "O número não existe",
            });
        } else {
            numberWA = "55" + number + "@s.whatsapp.net";

            if (isConnected()) {
                const exist = await sock.onWhatsApp(numberWA);

                if (exist?.jid || (exist && exist[0]?.jid)) {
                    sock.sendMessage(exist.jid || exist[0].jid, {
                        text: tempMessage,
                    })
                        .then((result) => {
                            res.status(200).json({
                                status: true,
                                response: result,
                            });
                        })
                        .catch((err) => {
                            res.status(500).json({
                                status: false,
                                response: err,
                            });
                        });
                }
            } else {
                res.status(500).json({
                    status: false,
                    response: "Você ainda não está conectado",
                });
            }
        }
    } catch (err) {
        res.status(500).send(err);
    }
});

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qrDinamic) {
        updateQR("qr");
    }
});

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qrDinamic, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR recebido, faça a varredura");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "usuário conectado");
            const { id, name } = sock?.user;
            var userinfo = id + " " + name;
            soket?.emit("user", userinfo);

            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Carregando...");

            break;
        default:
            break;
    }
};

connectToWhatsApp().catch((err) => console.log("erro inesperado: " + err)); // catch any errors
server.listen(port, () => {
    console.log("Servidor Rodando na Porta: " + port);
});
