const Transport = require('winston-transport');

class SupabaseTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.supabase = opts.supabase;
  }

  async log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    const { level, message, context, user_id } = info;

    try {
      // Use dynamic import to load ESM `strip-ansi`
      const stripAnsi = (await import('strip-ansi')).default;
      const cleanLevel = stripAnsi(level); // remove ANSI colors

      const { error } = await this.supabase.from('logs').insert([
        {
          level: cleanLevel,
          message,
          context: context || null,
          user_id: user_id || null,
        }
      ]);

      if (error) {
        console.error('🚨 Supabase insert error:', error);
      }
    } catch (err) {
      console.error('❌ Failed to log to Supabase:', err);
    }

    callback();
  }
}

module.exports = SupabaseTransport;
