<?php
if (!defined('ABSPATH')) exit;
function senuke_base_setup(){add_theme_support('title-tag');add_theme_support('post-thumbnails');add_theme_support('responsive-embeds');add_theme_support('align-wide');register_nav_menus(['primary'=>__('Primary Navigation','senuke-base'),'footer'=>__('Footer Navigation','senuke-base')]);}
add_action('after_setup_theme','senuke_base_setup');
function senuke_base_assets(){wp_enqueue_style('senuke-base',get_stylesheet_uri(),[],wp_get_theme()->get('Version'));wp_enqueue_script('senuke-base-menu',get_template_directory_uri().'/assets/menu.js',[],wp_get_theme()->get('Version'),true);}
add_action('wp_enqueue_scripts','senuke_base_assets');
function senuke_base_identity(){$v=get_option('senuke_ai_site_identity',[]);return is_array($v)?$v:[];}
function senuke_base_brand_name(){$v=senuke_base_identity();return trim((string)($v['businessName']??''))?:get_bloginfo('name');}
function senuke_base_logo_url(){$v=senuke_base_identity();$u=trim((string)($v['logoUrl']??''));return preg_match('/^(?:https:\/\/|data:image\/)/i',$u)?$u:'';}
