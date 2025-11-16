const db = require('../config/supabaseConfig');

exports.logUserActivity = async (user_id, description, metadata = {}) => {
  try {
    const { error } = await db.from('user_activity_logs').insert([
      {
        user_id,
        description,
        metadata,
      },
    ]);

    if (error) {
      console.error('Error logging user activity:', error.message);
    }
  } catch (err) {
    console.error('Unexpected error while logging user activity:', err);
  }
};
