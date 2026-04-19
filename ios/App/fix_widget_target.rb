#!/usr/bin/env ruby
# Fix missing PRODUCT_NAME on the widget extension target.

require 'xcodeproj'

project_path = File.expand_path('App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

widget = project.targets.find { |t| t.name == 'WaymarkActivity' }
raise 'WaymarkActivity target not found' if widget.nil?

widget.build_configurations.each do |config|
  bs = config.build_settings
  bs['PRODUCT_NAME'] = '$(TARGET_NAME)'
  bs['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  bs['ENABLE_USER_SCRIPT_SANDBOXING'] = 'YES'
end

project.save
puts 'Widget target PRODUCT_NAME set.'
