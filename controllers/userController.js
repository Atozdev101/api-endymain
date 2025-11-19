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
    // Build update object only with provided fields (not undefined)
    const updateData = {};
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (company !== undefined) updateData.company = company;
    if (address1 !== undefined) updateData.address1 = address1;
    if (address2 !== undefined) updateData.address2 = address2;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (country !== undefined) updateData.country = country;
    if (postalCode !== undefined) updateData.postal_code = postalCode;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Update public.users table
    const { data, error } = await db
      .from('users')
      .update(updateData)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update user profile:', {
        user_id: user.id,
        error: error.message,
        updateData
      });
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    // Verify that the update actually happened
    if (!data) {
      logger.error('Update query returned no data:', {
        user_id: user.id,
        updateData
      });
      return res.status(404).json({ error: 'User not found or update failed' });
    }

    // Also update auth.users metadata to keep them in sync
    // This prevents triggers/functions from overwriting public.users data on login
    try {
      // Get existing user metadata first to merge with new data
      const { data: existingAuthUser, error: fetchError } = await db.auth.admin.getUserById(user.id);
      
      if (!fetchError && existingAuthUser?.user) {
        const existingMetadata = existingAuthUser.user.user_metadata || {};
        
        // Build metadata update object, merging with existing metadata
        const authMetadata = { ...existingMetadata };
        if (firstName !== undefined) authMetadata.first_name = firstName;
        if (lastName !== undefined) authMetadata.last_name = lastName;
        if (phone !== undefined) authMetadata.phone = phone;
        if (company !== undefined) authMetadata.company = company;
        if (address1 !== undefined) authMetadata.address1 = address1;
        if (address2 !== undefined) authMetadata.address2 = address2;
        if (city !== undefined) authMetadata.city = city;
        if (state !== undefined) authMetadata.state = state;
        if (country !== undefined) authMetadata.country = country;
        if (postalCode !== undefined) authMetadata.postal_code = postalCode;

        // Update auth.users metadata
        const { error: authError } = await db.auth.admin.updateUserById(
          user.id,
          {
            user_metadata: authMetadata
          }
        );

        if (authError) {
          logger.warn('Failed to update auth.users metadata (non-critical):', {
            user_id: user.id,
            error: authError.message
          });
          // Don't fail the request if auth metadata update fails
        } else {
          logger.info('Auth users metadata updated successfully', {
            user_id: user.id
          });
        }
      } else if (fetchError) {
        logger.warn('Failed to fetch existing auth user for metadata update (non-critical):', {
          user_id: user.id,
          error: fetchError.message
        });
      }
    } catch (authErr) {
      logger.warn('Error updating auth.users metadata (non-critical):', {
        user_id: user.id,
        error: authErr.message
      });
      // Don't fail the request if auth metadata update fails
    }

    logger.info('User profile updated successfully', {
      user_id: user.id,
      updated_fields: Object.keys(updateData)
    });

    res.status(200).json({ 
      message: 'Profile updated successfully',
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
  }
  catch (err) {
    logger.error('Error updating user profile', {
      user_id: user.id,
      error: err.message,
      stack: err.stack
    });
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