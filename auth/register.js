import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://ciotsunxwnnjmzcavfwn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpb3RzdW54d25uam16Y2F2ZnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAxMjE2NjMsImV4cCI6MjA0NTY5NzY2M30.g7iHPPcwJksEfnyvZeiemLB-R5YOOCrKsC_1dd459RA');

    async function handleRegistration(event) {
        event.preventDefault();
            
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const username = document.getElementById('username').value;
            
        try {
                // 1. Sign up with Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.signUp({email,password,});

            if (authError) throw authError;

                // 2. Create user record in users table with initial balance
                const { error: dbError } = await supabase.from('users').insert([
                    {
                        id: authData.user.id,
                        username: username,
                        balance: 1000,
                        email: email
                    }
                ]);

                if (dbError) throw dbError;

                alert('Registration successful! Please check your email to verify your account.');
                window.location.href = 'login.html';
            } catch (error) {
                console.error('Registration error:', error.message);
                alert('Registration failed: ' + error.message);
            }
        }

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector('#register-form');
        if (form) {
            form.addEventListener('submit', handleRegistration);
        }
    });