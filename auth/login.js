import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://ciotsunxwnnjmzcavfwn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpb3RzdW54d25uam16Y2F2ZnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAxMjE2NjMsImV4cCI6MjA0NTY5NzY2M30.g7iHPPcwJksEfnyvZeiemLB-R5YOOCrKsC_1dd459RA');

    async function handleLogin(event) {
        event.preventDefault();
            
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
            
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            // Store the session
            localStorage.setItem('supabase.auth.token', data.session.access_token);
                
            // Redirect to simulator
            window.location.href = 'simulator.html';
        } catch (error) {
            console.error('Login error:', error.message);
            alert('Login failed: ' + error.message);
        }
        }

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector('#login-form');
        if (form) {
            form.addEventListener('submit', handleLogin);
        }
    });