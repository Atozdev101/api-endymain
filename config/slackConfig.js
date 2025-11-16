const axios = require("axios");


const sendSlackMessage = async (message,type) => {
  try {
    const isTest = process.env.SLACK_TEST;
    await axios.post("https://n8n.newn8n.atozserver.cfd/webhook/slack-log", {
      appName: "Atoz Emails Dashboard",
      type: type,
      isTest:isTest,
      message: message,
    }, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Slack log error:", error.message);
  }
};

const supportSendSlackMessage = async (message,type) => {
  try {
    await axios.post("https://n8n.newn8n.atozserver.cfd/webhook/slack-log", {
      appName: "Atoz Emails Dashboard",
      type: type,
      isTest:'support',
      message: message,
    }, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Slack log error:", error.message);
  }
};

module.exports = {sendSlackMessage,supportSendSlackMessage};
