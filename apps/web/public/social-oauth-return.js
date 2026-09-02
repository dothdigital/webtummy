const params = new URLSearchParams(window.location.search);
params.set("social_oauth_return", Date.now().toString());
window.location.replace(`/social-strategy?${params.toString()}${window.location.hash}`);
