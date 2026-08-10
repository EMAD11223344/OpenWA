#!/bin/sh
set -e

# Automatically create PostgreSQL schema if DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Ensuring target PostgreSQL schema exists..."
  
  node -e "
    const uri = process.env.DATABASE_CONNECTION_URI;
    if (!uri || (!uri.startsWith('postgres://') && !uri.startsWith('postgresql://'))) {
      process.exit(0);
    }
    
    // Extract schema name from URI (default: evolution)
    const match = uri.match(/[?&]schema=([^&]+)/);
    const schemaName = match ? match[1] : 'evolution';
    
    let pg;
    try {
      pg = require('pg');
    } catch (e) {
      try {
        pg = require('/app/node_modules/pg');
      } catch (err) {
        console.log('==> [Entrypoint] pg package not found, proceeding directly.');
        process.exit(0);
      }
    }
    
    const client = new pg.Client({ 
      connectionString: uri, 
      ssl: uri.includes('sslmode=require') || uri.includes('supabase.com') ? { rejectUnauthorized: false } : false 
    });

    client.connect()
      .then(() => client.query(\`CREATE SCHEMA IF NOT EXISTS "\${schemaName}";\`))
      .then(() => {
        console.log(\`==> [Entrypoint] Schema '\${schemaName}' verified/created successfully.\`);
        return client.end();
      })
      .catch((err) => {
        console.warn('==> [Entrypoint] Schema check warning (will proceed):', err.message);
        return client.end().catch(() => {});
      });
  " || true
fi

# Handover control to the primary process
exec "$@"
