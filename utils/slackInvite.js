const axios = require('axios');

const SUPPORT_TEAM_USER_IDS = (process.env.SUPPORT_TEAM_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean); // Ensure no empty or malformed IDs
const SLACK_TOKEN = process.env.SLACK_ADMIN_TOKEN;
const SUPPORT_ADMIN_USER_ID = process.env.SUPPORT_ADMIN_USER_ID || null; // Optional: Slack user ID to DM for manual invites

// Create a private support channel
async function createPrivateChannel(channelName) {
  try {
    const res = await axios.post('https://slack.com/api/conversations.create', {
      name: channelName,
      is_private: true,
    }, {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.data.ok) throw new Error(res.data.error);
    return res.data.channel.id;
  } catch (e) {
    console.error('Slack: Failed to create channel:', e.message);
    throw e;
  }
}

// Invite team users to the support channel (always attempt for all)
async function inviteUsersToChannel(channelId, userIds) {
  if (!userIds.length) return;
  try {
    await axios.post('https://slack.com/api/conversations.invite', {
      channel: channelId,
      users: userIds.join(','),
    }, {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    // Slack will ignore users already in the channel, log only real errors
    if (e.response && e.response.data && e.response.data.error !== 'already_in_channel') {
      console.error('Slack: Failed to invite users to channel:', e.message, e.response.data);
    }
  }
}

// Check if a user is already in the Slack workspace
async function isUserInWorkspace(email) {
  try {
    const res = await axios.get('https://slack.com/api/users.lookupByEmail', {
      params: { email },
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
      },
    });
    if (!res.data.ok) {
      console.error('Slack users.lookupByEmail error:', res.data);
    }
    return res.data.ok ? res.data.user : null;
  } catch (e) {
    console.error('Slack: Failed to lookup user by email:', e.message);
    return null;
  }
}

// Check if a user (by email username) is already a member of the channel
async function isUserInChannelByName(channelId, email) {
  try {
    const username = email.split('@')[0].toLowerCase();
    // Get channel members
    const res = await axios.get('https://slack.com/api/conversations.members', {
      params: { channel: channelId },
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    });
    if (!res.data.ok) {
      console.error('Slack conversations.members error:', res.data);
      return false;
    }
    const memberIds = res.data.members;
    // Get user info for each member (could be optimized/cached)
    for (const memberId of memberIds) {
      const userRes = await axios.get('https://slack.com/api/users.info', {
        params: { user: memberId },
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      });
      if (userRes.data.ok) {
        const profile = userRes.data.user.profile;
        // Check display name, real name, or email username
        if (
          (profile.display_name && profile.display_name.toLowerCase().includes(username)) ||
          (profile.real_name && profile.real_name.toLowerCase().includes(username)) ||
          (profile.email && profile.email.toLowerCase() === email.toLowerCase())
        ) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.error('Slack: Failed to check channel members:', e.message);
    return false;
  }
}

// Post a message in the support channel
async function postMessageToChannel(channelId, text) {
  try {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: channelId,
      text,
    }, {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    console.error('Slack: Failed to post message to channel:', e.message);
  }
}

// Optionally DM a support admin for manual invite
async function dmSupportAdmin(text) {
  if (!SUPPORT_ADMIN_USER_ID) return;
  try {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: SUPPORT_ADMIN_USER_ID,
      text,
    }, {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    console.error('Slack: Failed to DM support admin:', e.message);
  }
}

// Main setup function: one channel per user
async function setupClientSlackChannel(clientEmail, purchaseDetailsText) {
  const base = clientEmail.split('@')[0].replace(/[^a-z0-9]/gi, '');
  const channelName = `support-${base}`.toLowerCase().slice(0, 80);
  let channelId;
  let channelCreated = false;

  // Try to find or create the channel
  try {
    const res = await axios.get('https://slack.com/api/conversations.list', {
      params: { types: 'private_channel', limit: 1000 },
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    });
    if (res.data.ok && Array.isArray(res.data.channels)) {
      const found = res.data.channels.find(c => c.name === channelName);
      if (found) {
        channelId = found.id;
      }
    } else {
      console.error('Slack conversations.list error:', res.data);
    }
  } catch (e) {
    console.error('Failed to list channels:', e.message);
  }

  if (!channelId) {
    channelId = await createPrivateChannel(channelName);
    channelCreated = true;
  }

  // Always invite all support team members (not just on creation)
  await inviteUsersToChannel(channelId, SUPPORT_TEAM_USER_IDS);

  // Check if user is already in workspace
  const user = await isUserInWorkspace(clientEmail);
  let userInChannel = false;
  if (!user) {
    // Fallback: check if user is already in the channel by name/email
    userInChannel = await isUserInChannelByName(channelId, clientEmail);
  }

  // Only post warning if user is truly not in workspace and not in channel
  if (!user && !userInChannel) {
    const manualMsg = `⚠️ Client *${clientEmail}* is not yet in the Slack workspace. Please invite them manually and add them to <#${channelId}>.`;
    await postMessageToChannel(channelId, manualMsg);
    await dmSupportAdmin(manualMsg);
  } else if (user) {
    // Add client to the channel if not already present
    await inviteUsersToChannel(channelId, [user.id]);
  }

  // Always post purchase details to the channel
  if (purchaseDetailsText) {
    await postMessageToChannel(channelId, purchaseDetailsText);
  }
  return channelId;
}

module.exports = {
  setupClientSlackChannel,
  createPrivateChannel,
  inviteUsersToChannel,
  postMessageToChannel,
  isUserInWorkspace,
  dmSupportAdmin,
};
