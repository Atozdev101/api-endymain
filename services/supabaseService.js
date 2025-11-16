const supabase = require('../config/supabase');

const getUserById = async (userId) => {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  return data.user;
};
//etcc.


module.exports = {
  getUserById,
};
