#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  console.log('Testing Supabase connection...');
  console.log('URL:', url ? 'Present' : 'Missing');
  console.log('Key:', key ? 'Present' : 'Missing');

  if (!url || !key) {
    console.error('Missing credentials');
    return;
  }

  const supabase = createClient(url, key);

  // Test 1: Simple query
  console.log('\nTest 1: Simple query...');
  try {
    const { data, error } = await supabase
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public')
      .limit(5);

    if (error) {
      console.error('Query error:', error.message);
    } else {
      console.log('Success! Found tables:', data);
    }
  } catch (e) {
    console.error('Exception:', e.message);
  }

  // Test 2: Using RPC if available
  console.log('\nTest 2: RPC test...');
  try {
    const { data, error } = await supabase.rpc('ping');

    if (error) {
      console.error('RPC error:', error.message);
      console.log('This is expected if ping function doesn\'t exist');
    } else {
      console.log('RPC Success:', data);
    }
  } catch (e) {
    console.error('RPC Exception:', e.message);
  }

  // Test 3: Raw SQL via REST API
  console.log('\nTest 3: Direct REST API test...');
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      }
    });

    console.log('REST API Status:', response.status);
    if (!response.ok) {
      const text = await response.text();
      console.error('Response:', text.substring(0, 200));
    }
  } catch (e) {
    console.error('REST Exception:', e.message);
  }
}

testConnection().catch(console.error);