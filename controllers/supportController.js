const supabase = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {supportSendSlackMessage} = require('../config/slackConfig');

// Create new support ticket
const createSupportTicket = async (req, res) => {
  try {
    const { user_id, issue_type, subject, description, file_urls } = req.body;

    // Validate required fields
    if (!user_id || !issue_type || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user_id, issue_type, subject, description'
      });
    }

    // Generate ticket ID
    const ticket_id = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create ticket in Supabase
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id,
        ticket_id,
        issue_type,
        subject,
        description,
        file_urls: file_urls || null,
        status: 'open'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating support ticket:', { error, user_id });
      return res.status(500).json({
        success: false,
        message: 'Error creating support ticket',
        error: error.message
      });
    }

    // Get user details for Slack notification
    const { data: user } = await supabase
      .from('users')
      .select('email, first_name, last_name')
      .eq('id', user_id)
      .single();

    // Send Slack notification
    try {
      const slackMessage = `🎫 New Support Ticket Created

*Ticket ID:* ${ticket_id}
*Email:* ${user?.email || 'N/A'}
*Issue Type:* ${issue_type}
*Subject:* ${subject}
*Description:* ${description}
*Attachments:* ${file_urls}
*Created at:* ${new Date().toLocaleString()}`;

      await supportSendSlackMessage(slackMessage, 'support_ticket');

      //insert job in jobs table
      const { error: insertJobErr } = await supabase.from('workspace_jobs').insert({
        workspace_id: 'a5abb9c4-7d4a-46ad-832a-8b889be6fc6e',
        user_id: user_id,
        job_type: 'support',
        status: 'new',
        notes: description,
        assigned_to:'bf607a68-7337-4d75-9674-abe9b42a38d1',
        metadata: { job_title:subject, ticket_id, user_id, issue_type, subject, description, file_urls }
      });
      if (insertJobErr) {
        console.log('Error inserting job:', { insertJobErr, ticket_id });
        logger.error('Error inserting job:', { insertJobErr, ticket_id });
      }
      logger.info('Slack notification sent successfully', { ticket_id });
    } catch (slackError) {
      logger.error('Error sending Slack notification:', { slackError, ticket_id });
      // Don't fail the request if Slack notification fails
    }

    // Log the activity
    logger.info('Support ticket created successfully', {
      ticket_id,
      user_id,
      issue_type,
      subject
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: ticket
    });

  } catch (error) {
    logger.error('Error in createSupportTicket:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get user's support tickets
const getUserTickets = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching user tickets:', { error, user_id });
      return res.status(500).json({
        success: false,
        message: 'Error fetching tickets',
        error: error.message
      });
    }

    res.status(200).json({
      success: true,
      data: tickets
    });

  } catch (error) {
    logger.error('Error in getUserTickets:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get specific ticket with messages
const getTicketWithMessages = async (req, res) => {
  try {
    const { ticket_id } = req.params;
    const { user_id } = req.query;

    if (!ticket_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: 'Ticket ID and User ID are required'
      });
    }

    // Get ticket details
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', ticket_id)
      .eq('user_id', user_id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Get ticket messages
    const { data: messages, error: messagesError } = await supabase
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });

    if (messagesError) {
      logger.error('Error fetching ticket messages:', { messagesError, ticket_id });
      return res.status(500).json({
        success: false,
        message: 'Error fetching messages',
        error: messagesError.message
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ticket,
        messages
      }
    });

  } catch (error) {
    logger.error('Error in getTicketWithMessages:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Add message to ticket
const addTicketMessage = async (req, res) => {
  try {
    const { ticket_id, user_id, message, is_admin_reply = false } = req.body;

    if (!ticket_id || !user_id || !message) {
      return res.status(400).json({
        success: false,
        message: 'Ticket ID, User ID, and Message are required'
      });
    }

    // Verify ticket exists and belongs to user
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', ticket_id)
      .eq('user_id', user_id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Add message
    const { data: newMessage, error: messageError } = await supabase
      .from('support_ticket_messages')
      .insert({
        ticket_id,
        user_id,
        message,
        is_admin_reply
      })
      .select()
      .single();

    if (messageError) {
      logger.error('Error adding ticket message:', { messageError, ticket_id });
      return res.status(500).json({
        success: false,
        message: 'Error adding message',
        error: messageError.message
      });
    }

    // Update ticket status to 'in_progress' if it was 'open'
    if (ticket.status === 'open') {
      await supabase
        .from('support_tickets')
        .update({ status: 'in_progress' })
        .eq('id', ticket_id);
    }

    res.status(201).json({
      success: true,
      message: 'Message added successfully',
      data: newMessage
    });

  } catch (error) {
    logger.error('Error in addTicketMessage:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

module.exports = {
  createSupportTicket,
  getUserTickets,
  getTicketWithMessages,
  addTicketMessage
};