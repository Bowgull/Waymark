#!/usr/bin/env ruby
# One-shot script to add the WaymarkActivity Widget Extension target to the Xcode project.
# Safe to re-run — it checks for existing target before creating.

require 'xcodeproj'

project_path = File.expand_path('App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'App' }
raise 'App target not found' if app_target.nil?

if project.targets.any? { |t| t.name == 'WaymarkActivity' }
  puts 'WaymarkActivity target already exists — nothing to do.'
  exit 0
end

# Pull signing/team info from the App target so the widget matches.
app_debug_settings = app_target.build_configurations.find { |c| c.name == 'Debug' }.build_settings
dev_team = app_debug_settings['DEVELOPMENT_TEAM']
app_bundle_id = app_debug_settings['PRODUCT_BUNDLE_IDENTIFIER']
widget_bundle_id = "#{app_bundle_id}.WaymarkActivity"

puts "Dev team: #{dev_team}"
puts "Widget bundle id: #{widget_bundle_id}"

# Create the widget extension target.
widget_target = project.new_target(
  :app_extension,
  'WaymarkActivity',
  :ios,
  '17.0',
  nil,
  :swift
)

# Widget target build settings.
widget_target.build_configurations.each do |config|
  bs = config.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER'] = widget_bundle_id
  bs['DEVELOPMENT_TEAM'] = dev_team
  bs['INFOPLIST_FILE'] = 'WaymarkActivity/Info.plist'
  bs['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  bs['SWIFT_VERSION'] = '5.0'
  bs['TARGETED_DEVICE_FAMILY'] = '1,2'
  bs['CODE_SIGN_STYLE'] = 'Automatic'
  bs['GENERATE_INFOPLIST_FILE'] = 'NO'
  bs['SKIP_INSTALL'] = 'YES'
  bs['LD_RUNPATH_SEARCH_PATHS'] = [
    '$(inherited)',
    '@executable_path/Frameworks',
    '@executable_path/../../Frameworks',
  ]
  bs['CURRENT_PROJECT_VERSION'] = '1'
  bs['MARKETING_VERSION'] = '1.0'
end

# Create the group and add source files.
widget_group = project.main_group.find_subpath('WaymarkActivity', true)
widget_group.set_source_tree('<group>')
widget_group.set_path('WaymarkActivity')

bundle_ref = widget_group.new_reference('WaymarkActivityBundle.swift')
widget_ref = widget_group.new_reference('WaymarkActivityWidget.swift')
plist_ref = widget_group.new_reference('Info.plist')

widget_target.add_file_references([bundle_ref, widget_ref])

# Share WaymarkAttributes.swift with the widget target too.
app_group = project.main_group.find_subpath('App', false)
attrs_ref = app_group.files.find { |f| f.path == 'WaymarkAttributes.swift' }
if attrs_ref
  widget_target.add_file_references([attrs_ref])
  puts 'Added WaymarkAttributes.swift to widget target.'
else
  puts 'WARN: WaymarkAttributes.swift not found in App group; widget will fail to reference attributes.'
end

# App target depends on widget target.
app_target.add_dependency(widget_target)

# App target embeds the widget in PlugIns folder (standard extension embed phase).
embed_phase = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
embed_phase.symbol_dst_subfolder_spec = :plug_ins
embed_phase.run_only_for_deployment_postprocessing = '0'

widget_product = widget_target.product_reference
embed_build_file = embed_phase.add_file_reference(widget_product)
embed_build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save

puts 'Widget extension target added successfully.'
